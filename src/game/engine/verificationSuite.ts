import { compileAndValidate } from '../../interpreter/validator';
import { CodeInterpreter } from '../../interpreter/interpreter';
import { GameState } from './GameState';
import { GameController } from './GameController';
import { getDifficultyConfig } from '../config/combatConfig';
import { validatePvPProgram } from '../pvp/pvpValidator';
import { PvPBattleController } from '../pvp/PvPBattleController';
import { DEFAULT_PVP_CONFIG } from '../pvp/pvpTypes';
import {
  CommandExecutionResult,
  IGameAPI,
  SupportedCommandName,
  SupportedVariableName,
} from '../../interpreter/gameApi';

/**
 * Deterministic verification suite for Phase 2 test cases (Tests 1-6 + Error Validation).
 */
export async function runInterpreterVerificationSuite(): Promise<{
  passed: boolean;
  results: string[];
}> {
  const results: string[] = [];
  let allPassed = true;

  const assert = (condition: boolean, label: string) => {
    if (condition) {
      results.push(`PASS: ${label}`);
    } else {
      allPassed = false;
      results.push(`FAIL: ${label}`);
    }
  };

  const createTestHarness = () => {
    const state = new GameState();
    const executedLog: string[] = [];

    const api: IGameAPI = {
      getVariable: (name: SupportedVariableName) => state.getVariable(name),
      executeCommand: (
        name: SupportedCommandName,
        args: number[]
      ): CommandExecutionResult => {
        switch (name) {
          case 'move_right':
            if (state.isInsideArena(state.player.x + 1, state.player.y) && !state.isWallAt(state.player.x + 1, state.player.y)) {
              state.player.x += 1;
            }
            executedLog.push('move_right()');
            return { success: true, formattedCall: 'move_right()' };
          case 'move_left':
            if (state.isInsideArena(state.player.x - 1, state.player.y) && !state.isWallAt(state.player.x - 1, state.player.y)) {
              state.player.x -= 1;
            }
            executedLog.push('move_left()');
            return { success: true, formattedCall: 'move_left()' };
          case 'move_up':
            if (state.isInsideArena(state.player.x, state.player.y - 1) && !state.isWallAt(state.player.x, state.player.y - 1)) {
              state.player.y -= 1;
            }
            executedLog.push('move_up()');
            return { success: true, formattedCall: 'move_up()' };
          case 'move_down':
            if (state.isInsideArena(state.player.x, state.player.y + 1) && !state.isWallAt(state.player.x, state.player.y + 1)) {
              state.player.y += 1;
            }
            executedLog.push('move_down()');
            return { success: true, formattedCall: 'move_down()' };
          case 'bomb':
            executedLog.push(`bomb(${args[0]}, ${args[1]})`);
            return { success: true, formattedCall: `bomb(${args[0]}, ${args[1]})` };
          case 'laser':
            executedLog.push('laser()');
            return { success: true, formattedCall: 'laser()' };
          case 'shockwave':
            executedLog.push('shockwave()');
            return { success: true, formattedCall: 'shockwave()' };
          case 'wait':
            executedLog.push(`wait(${args[0]})`);
            return { success: true, formattedCall: `wait(${args[0]})`, waitTicks: args[0] };
        }
      },
    };

    const interpreter = new CodeInterpreter(api);
    return { state, executedLog, interpreter };
  };

  // TEST 1: Basic movement
  {
    const { state, interpreter } = createTestHarness();
    const res = compileAndValidate(`move_right()\nmove_right()\nmove_down()`);
    assert(res.valid && !!res.ast, 'TEST 1 compiles validly');
    interpreter.start(res.ast!);
    while (await interpreter.stepTick()) {
      // step until done
    }
    assert(
      state.player.x === 4 && state.player.y === 8,
      `TEST 1 moves two cells right and one cell down to (4, 8), got (${state.player.x}, ${state.player.y})`
    );
  }

  // TEST 2: Conditional logic
  {
    const { state, interpreter } = createTestHarness();
    const code = `if health > 50:\n    move_right()\nelse:\n    move_left()`;
    const res = compileAndValidate(code);
    assert(res.valid && !!res.ast, 'TEST 2 compiles validly');
    interpreter.start(res.ast!);
    while (await interpreter.stepTick()) {}
    assert(state.player.x === 3, 'TEST 2 executes true branch when health=100');

    state.reset();
    state.player.health = 30;
    interpreter.start(res.ast!);
    while (await interpreter.stepTick()) {}
    assert(state.player.x === 1, 'TEST 2 executes else branch when health=30');
  }

  // TEST 3: Bounded loop
  {
    const { state, executedLog, interpreter } = createTestHarness();
    const code = `for i in range(5):\n    move_right()`;
    const res = compileAndValidate(code);
    assert(res.valid && !!res.ast, 'TEST 3 compiles validly');
    interpreter.start(res.ast!);
    while (await interpreter.stepTick()) {}
    assert(
      executedLog.length === 5 && state.player.x === 7,
      `TEST 3 executes 5 sequential move_right() calls to x=7, got x=${state.player.x}`
    );
  }

  // TEST 4: Infinite loop with wait(1) & boundary clamping + STOP
  {
    const { state, interpreter } = createTestHarness();
    const code = `while True:\n    move_right()\n    wait(1)`;
    const res = compileAndValidate(code);
    assert(res.valid && !!res.ast, 'TEST 4 compiles validly');
    interpreter.start(res.ast!);
    for (let tick = 0; tick < 40; tick++) {
      await interpreter.stepTick();
    }
    assert(
      state.player.x === 14 && interpreter.isRunning(),
      `TEST 4 moves right and clamps at arena boundary x=14 while remaining responsive, got x=${state.player.x}`
    );
    interpreter.stop();
    assert(!interpreter.isRunning(), 'TEST 4 stops cleanly when stop() is called');
  }

  // TEST 5: Invalid commands, variables, and syntax
  {
    const invalidCmd = compileAndValidate(`teleport()`);
    assert(
      !invalidCmd.valid && invalidCmd.error?.message === 'Unknown command: teleport()',
      `TEST 5a rejects teleport() with 'Unknown command: teleport()', got '${invalidCmd.error?.message}'`
    );

    const invalidFly = compileAndValidate(`fly_up()`);
    assert(
      !invalidFly.valid && invalidFly.error?.message === 'Unknown command: fly_up()',
      `TEST 5b rejects fly_up() with 'Unknown command: fly_up()'`
    );

    const invalidVar = compileAndValidate(`move_right(speed)`);
    assert(
      !invalidVar.valid && invalidVar.error?.message === 'Undefined variable: speed',
      `TEST 5c rejects move_right(speed) with 'Undefined variable: speed', got '${invalidVar.error?.message}'`
    );

    const invalidSyntax = compileAndValidate(`if health > :\n    attack()`);
    assert(
      !invalidSyntax.valid &&
        Boolean(invalidSyntax.error?.message.startsWith('Syntax error on line 1')),
      `TEST 5d rejects invalid syntax with 'Syntax error on line 1', got '${invalidSyntax.error?.message}'`
    );
  }

  // TEST 6: Combined actions
  {
    const { executedLog, interpreter } = createTestHarness();
    const code = `move_right()\nbomb(x, y)\nlaser()`;
    const res = compileAndValidate(code);
    assert(res.valid && !!res.ast, 'TEST 6 compiles validly');
    interpreter.start(res.ast!);
    while (await interpreter.stepTick()) {}
    assert(
      executedLog.join(' -> ') === 'move_right() -> bomb(3, 7) -> laser()',
      `TEST 6 executes all three actions in order with dynamic (x, y), got '${executedLog.join(' -> ')}'`
    );
  }

  // TEST 7: range(stop), range(start, stop), range(start, stop, step)
  {
    // 1-arg: range(4) -> 0, 1, 2, 3
    const h1 = createTestHarness();
    const res1 = compileAndValidate(`for i in range(4):\n    bomb(i, 0)`);
    assert(res1.valid && !!res1.ast, 'range(stop) compiles validly');
    h1.interpreter.start(res1.ast!);
    while (await h1.interpreter.stepTick()) {}
    assert(
      h1.executedLog.join(', ') === 'bomb(0, 0), bomb(1, 0), bomb(2, 0), bomb(3, 0)',
      `range(4) produces 0, 1, 2, 3, got '${h1.executedLog.join(', ')}'`
    );

    // 2-arg: range(2, 6) -> 2, 3, 4, 5
    const h2 = createTestHarness();
    const res2 = compileAndValidate(`for i in range(2, 6):\n    bomb(i, 1)`);
    assert(res2.valid && !!res2.ast, 'range(start, stop) compiles validly');
    h2.interpreter.start(res2.ast!);
    while (await h2.interpreter.stepTick()) {}
    assert(
      h2.executedLog.join(', ') === 'bomb(2, 1), bomb(3, 1), bomb(4, 1), bomb(5, 1)',
      `range(2, 6) produces 2, 3, 4, 5, got '${h2.executedLog.join(', ')}'`
    );

    // 3-arg positive step: range(1, 8, 2) -> 1, 3, 5, 7
    const h3 = createTestHarness();
    const res3 = compileAndValidate(`for i in range(1, 8, 2):\n    bomb(i, 2)`);
    assert(res3.valid && !!res3.ast, 'range(start, stop, step) compiles validly');
    h3.interpreter.start(res3.ast!);
    while (await h3.interpreter.stepTick()) {}
    assert(
      h3.executedLog.join(', ') === 'bomb(1, 2), bomb(3, 2), bomb(5, 2), bomb(7, 2)',
      `range(1, 8, 2) produces 1, 3, 5, 7, got '${h3.executedLog.join(', ')}'`
    );
  }

  // TEST 8: Negative steps in range(start, stop, step)
  {
    const hNeg = createTestHarness();
    const resNeg = compileAndValidate(`for i in range(5, 1, -1):\n    bomb(i, 0)`);
    assert(resNeg.valid && !!resNeg.ast, 'range(5, 1, -1) compiles validly');
    hNeg.interpreter.start(resNeg.ast!);
    while (await hNeg.interpreter.stepTick()) {}
    assert(
      hNeg.executedLog.join(', ') === 'bomb(5, 0), bomb(4, 0), bomb(3, 0), bomb(2, 0)',
      `range(5, 1, -1) produces 5, 4, 3, 2, got '${hNeg.executedLog.join(', ')}'`
    );

    const hNegStep = createTestHarness();
    const resNegStep = compileAndValidate(`for i in range(10, 1, -3):\n    bomb(i, 0)`);
    assert(resNegStep.valid && !!resNegStep.ast, 'range(10, 1, -3) compiles validly');
    hNegStep.interpreter.start(resNegStep.ast!);
    while (await hNegStep.interpreter.stepTick()) {}
    assert(
      hNegStep.executedLog.join(', ') === 'bomb(10, 0), bomb(7, 0), bomb(4, 0)',
      `range(10, 1, -3) stops before 1 (exclusive) producing 10, 7, 4, got '${hNegStep.executedLog.join(', ')}'`
    );
  }

  // TEST 9: Empty ranges
  {
    const emptyCases = [
      `for i in range(0):\n    move_right()`,
      `for i in range(-4):\n    move_right()`,
      `for i in range(5, 2):\n    move_right()`,
      `for i in range(2, 5, -1):\n    move_right()`,
      `for i in range(3, 3):\n    move_right()`,
    ];
    for (const src of emptyCases) {
      const h = createTestHarness();
      const res = compileAndValidate(src);
      assert(res.valid && !!res.ast, `Empty range '${src.split('\n')[0]}' compiles validly`);
      h.interpreter.start(res.ast!);
      while (await h.interpreter.stepTick()) {}
      assert(
        h.executedLog.length === 0,
        `Empty range '${src.split('\n')[0]}' executes 0 iterations, got ${h.executedLog.length}`
      );
    }
  }

  // TEST 10: Zero step, non-integer arguments, and invalid argument counts
  {
    // Zero step (static)
    const zeroStatic = compileAndValidate(`for i in range(0, 5, 0):\n    move_right()`);
    assert(
      !zeroStatic.valid && Boolean(zeroStatic.error?.message.includes('must not be zero')),
      `range(0, 5, 0) rejected with zero-step error: '${zeroStatic.error?.message}'`
    );

    // Zero step (dynamic variable at runtime)
    let runtimeErrMsg = '';
    const hDynZero = createTestHarness();
    const interpreterWithErr = new CodeInterpreter(
      {
        getVariable: (n) => hDynZero.state.getVariable(n),
        executeCommand: () => ({ success: true, formattedCall: 'move_right()' }),
      },
      {
        onLog: (msg, type) => {
          if (type === 'error') runtimeErrMsg = msg;
        },
      }
    );
    const dynZeroCompile = compileAndValidate(
      `s = 0\nfor i in range(0, 5, s):\n    move_right()`
    );
    assert(dynZeroCompile.valid && !!dynZeroCompile.ast, 'Dynamic step variable compiles');
    interpreterWithErr.start(dynZeroCompile.ast!);
    while (await interpreterWithErr.stepTick()) {}
    assert(
      runtimeErrMsg.includes('must not be zero'),
      `Dynamic step=0 rejected at runtime: '${runtimeErrMsg}'`
    );

    // Non-integer arguments
    const floatArg = compileAndValidate(`for i in range(3.5):\n    move_right()`);
    assert(
      !floatArg.valid && Boolean(floatArg.error?.message.includes('must be integers')),
      `Non-integer range(3.5) rejected: '${floatArg.error?.message}'`
    );

    const boolArg = compileAndValidate(`for i in range(1, True):\n    move_right()`);
    assert(
      !boolArg.valid && Boolean(boolArg.error?.message.includes('must be integers')),
      `Boolean range(1, True) rejected: '${boolArg.error?.message}'`
    );

    // Invalid argument counts: 0 args and 4 args
    const zeroArgs = compileAndValidate(`for i in range():\n    move_right()`);
    assert(
      !zeroArgs.valid && Boolean(zeroArgs.error?.message.includes('expected 1 to 3 arguments')),
      `0-arg range() rejected: '${zeroArgs.error?.message}'`
    );

    const fourArgs = compileAndValidate(`for i in range(1, 2, 3, 4):\n    move_right()`);
    assert(
      !fourArgs.valid && Boolean(fourArgs.error?.message.includes('expected 1 to 3 arguments')),
      `4-arg range(1, 2, 3, 4) rejected: '${fourArgs.error?.message}'`
    );
  }

  // TEST 11: Nested loops & mid-loop STOP
  {
    const hNested = createTestHarness();
    const nestedCode = `for i in range(1, 3):\n    for j in range(4, 2, -1):\n        bomb(i, j)`;
    const resNested = compileAndValidate(nestedCode);
    assert(resNested.valid && !!resNested.ast, 'Nested range loops compile validly');
    hNested.interpreter.start(resNested.ast!);
    while (await hNested.interpreter.stepTick()) {}
    assert(
      hNested.executedLog.join(', ') ===
        'bomb(1, 4), bomb(1, 3), bomb(2, 4), bomb(2, 3)',
      `Nested loops execute in sequence: '${hNested.executedLog.join(', ')}'`
    );

    // Mid-loop STOP after 2 ticks
    const hStop = createTestHarness();
    const stopRes = compileAndValidate(`for i in range(0, 10, 2):\n    move_right()`);
    hStop.interpreter.start(stopRes.ast!);
    await hStop.interpreter.stepTick();
    await hStop.interpreter.stepTick();
    hStop.interpreter.stop();
    const afterStopTick = await hStop.interpreter.stepTick();
    assert(
      !afterStopTick && hStop.executedLog.length === 2,
      `STOP mid-loop halts after 2 ticks, executed=${hStop.executedLog.length}`
    );
  }

  // TEST 12: Game Lifecycle (No Auto-Start Before RUN), Independent Enemy AI, Directional Laser & Shockwave
  {
    const controller = new GameController();
    const gs = controller.gameState;

    // 1. Verify 3 distinct enemy archetypes exist and simulation is initially inactive
    const chaser = gs.enemies.find((e) => e.archetype === 'CHASER')!;
    const bomber = gs.enemies.find((e) => e.archetype === 'BOMBER')!;
    const laserShooter = gs.enemies.find(
      (e) => e.archetype === 'LASER_SHOOTER'
    )!;
    assert(
      Boolean(chaser && bomber && laserShooter) && !gs.simulationActive,
      'All 3 enemy archetypes are initialized and simulation is inactive before RUN'
    );

    // 2. Verify NOTHING moves or attacks before RUN is pressed
    const initChaserX = chaser.x;
    const initChaserY = chaser.y;
    let simTime = 0;
    for (let step = 0; step < 80; step++) {
      simTime += 80;
      controller.updateSimulation(simTime, 80);
    }
    assert(
      chaser.x === initChaserX &&
        chaser.y === initChaserY &&
        gs.player.health === 100 &&
        gs.bombs.length === 0,
      'Enemies remain stationary and inactive before RUN is clicked'
    );

    // 3. Start simulation and verify Chaser moves independently while player is idle
    controller.startSimulation();
    for (let step = 0; step < 80; step++) {
      simTime += 80;
      controller.updateSimulation(simTime, 80);
    }
    assert(
      chaser.x !== initChaserX || chaser.y !== initChaserY,
      `Chaser moves independently after simulation starts: (${initChaserX},${initChaserY}) -> (${chaser.x},${chaser.y})`
    );

    // 4. Verify Laser Shooter state machine transitions: SEARCH -> AIM -> CHARGE -> FIRE -> COOLDOWN
    controller.reset();
    controller.startSimulation();
    simTime = 0;
    const seenStates = new Set<string>();
    const ls = controller.gameState.enemies.find(
      (e) => e.archetype === 'LASER_SHOOTER'
    )!;
    ls.initialDelayRemainingMs = 0;
    seenStates.add(ls.aiState);
    for (let step = 0; step < 110; step++) {
      simTime += 60;
      controller.updateSimulation(simTime, 60);
      seenStates.add(ls.aiState);
    }
    assert(
      seenStates.has('SEARCH') &&
        seenStates.has('AIM') &&
        seenStates.has('CHARGE') &&
        seenStates.has('COOLDOWN'),
      `Laser Shooter transitions through SEARCH -> AIM -> CHARGE -> FIRE -> COOLDOWN, seen: ${Array.from(
        seenStates
      ).join(', ')}`
    );
    assert(
      controller.gameState.player.health < 100,
      `Laser Shooter damages stationary player on row 7, player health=${controller.gameState.player.health}`
    );

    // 5. Verify temporary invulnerability prevents repeated frame damage
    const hpAfterHit = controller.gameState.player.health;
    const blockedRes = controller.gameState.applyDamageToPlayer(20, 11, 7);
    assert(
      !blockedRes.damaged &&
        blockedRes.invulnerableBlocked &&
        controller.gameState.player.health === hpAfterHit,
      'Temporary invulnerability blocks repeated immediate damage'
    );

    // 6. Verify Bomber places a bomb with 5-tick countdown and blast radius when near player
    controller.reset();
    controller.startSimulation();
    const bm = controller.gameState.enemies.find(
      (e) => e.archetype === 'BOMBER'
    )!;
    bm.x = 5;
    bm.y = 7;
    bm.initialDelayRemainingMs = 0;
    simTime = 0;
    for (let step = 0; step < 35; step++) {
      simTime += 60;
      controller.updateSimulation(simTime, 60);
    }
    assert(
      controller.gameState.bombs.length > 0,
      `Bomber places predictive bomb near player, active bombs=${controller.gameState.bombs.length}`
    );
    const activeBomb = controller.gameState.bombs[0];
    assert(
      activeBomb.countdown === 5 && activeBomb.blastRadius === 1,
      `Placed bomb has countdown=${activeBomb.countdown} and blastRadius=${activeBomb.blastRadius}`
    );

    // Advance simulation until bomb detonates
    for (let step = 0; step < 75; step++) {
      simTime += 80;
      controller.updateSimulation(simTime, 80);
    }
    assert(
      controller.gameState.bombs.length === 0,
      'Bomb countdown expires and detonates cleanly'
    );

    // 7. Verify STOP only stops player code while independent Enemy AI continues moving
    controller.reset();
    controller.runCode('while True:\n    wait(1)');
    controller.stop();
    assert(
      controller.gameState.simulationActive,
      'STOP keeps enemy simulation active after RUN was pressed'
    );
    const chaserAfterStop = controller.gameState.enemies.find(
      (e) => e.archetype === 'CHASER'
    )!;
    chaserAfterStop.initialDelayRemainingMs = 0;
    const cxBefore = chaserAfterStop.x;
    const cyBefore = chaserAfterStop.y;
    for (let step = 0; step < 35; step++) {
      simTime += 80;
      controller.updateSimulation(simTime, 80);
    }
    assert(
      chaserAfterStop.x !== cxBefore || chaserAfterStop.y !== cyBefore,
      'STOP stops player code but independent Enemy AI continues moving'
    );

    // 8. Verify RESET stops simulation and returns to waiting state
    controller.reset();
    assert(
      !controller.gameState.simulationActive &&
        controller.gameState.player.health === 100 &&
        controller.gameState.getLivingEnemies().length === 3 &&
        controller.gameState.bombs.length === 0,
      'RESET stops simulation, restores player health (100), all 3 enemies, and clears bombs'
    );

    // 9. TEST EASY DIFFICULTY BALANCING TARGETS
    const easyCfg = getDifficultyConfig('Easy');
    assert(
      easyCfg.enemies.CHASER.attackDamage >= 3 &&
        easyCfg.enemies.CHASER.attackDamage <= 5,
      `Easy Chaser contact damage (${easyCfg.enemies.CHASER.attackDamage}) is balanced between 3-5 HP`
    );
    assert(
      easyCfg.enemies.CHASER.moveIntervalMs >= 2000 &&
        easyCfg.enemies.CHASER.moveIntervalMs <= 2500,
      `Easy Chaser move interval (${easyCfg.enemies.CHASER.moveIntervalMs}ms) is between 2.0-2.5s`
    );
    assert(
      easyCfg.enemies.BOMBER.attackDamage >= 10 &&
        easyCfg.enemies.BOMBER.attackDamage <= 15,
      `Easy Bomber explosion damage (${easyCfg.enemies.BOMBER.attackDamage}) is balanced between 10-15 HP`
    );
    assert(
      easyCfg.enemies.BOMBER.bombCountdownTicks *
        (easyCfg.enemies.BOMBER.bombStepDurationMs / 1000) ===
        5.0,
      `Easy Bomber countdown duration is 5.0s`
    );
    assert(
      easyCfg.enemies.LASER_SHOOTER.attackDamage >= 5 &&
        easyCfg.enemies.LASER_SHOOTER.attackDamage <= 10,
      `Easy Laser damage (${easyCfg.enemies.LASER_SHOOTER.attackDamage}) is balanced between 5-10 HP`
    );
    assert(
      easyCfg.enemies.LASER_SHOOTER.chargeDurationMs === 4000,
      `Easy Laser charging time is 4.0s (${easyCfg.enemies.LASER_SHOOTER.chargeDurationMs}ms)`
    );
    assert(
      easyCfg.playerInvulnerabilityDurationMs === 1500,
      `Easy Player invulnerability is 1.5s (${easyCfg.playerInvulnerabilityDurationMs}ms)`
    );

    // 10. TEST DIRECTIONAL LASER IN ALL 4 DIRECTIONS (East, West, North, South)
    controller.reset();
    // Place player at center (7, 7) and test firing in all 4 directions
    controller.gameState.player.x = 7;
    controller.gameState.player.y = 7;
    const e1 = controller.gameState.enemies[0];
    const e2 = controller.gameState.enemies[1];
    const e3 = controller.gameState.enemies[2];

    // Place e1 North at (7, 3), e2 South at (7, 11), e3 West at (3, 7)
    e1.x = 7;
    e1.y = 3;
    e1.health = 60;
    e2.x = 7;
    e2.y = 11;
    e2.health = 60;
    e3.x = 3;
    e3.y = 7;
    e3.health = 60;

    // Move up (faces north) and fire laser -> should hit e1 at (7, 3) and NOT hit e2 behind at (7, 11)
    await controller.executeCommand('move_up', [], 1);
    assert(
      controller.gameState.player.facing === 'north',
      'move_up() updates player facing to north'
    );
    await controller.executeCommand('laser', [], 2);
    assert(
      e1.health < 60 && e2.health === 60 && e3.health === 60,
      `North-facing laser() hits enemy above (HP=${e1.health}) without damaging enemy behind (HP=${e2.health})`
    );

    // Move down (faces south) and fire laser -> should hit e2 at (7, 11)
    await controller.executeCommand('move_down', [], 3);
    assert(
      controller.gameState.player.facing === 'south',
      'move_down() updates player facing to south'
    );
    await controller.executeCommand('laser', [], 4);
    assert(
      e2.health < 60,
      `South-facing laser() hits enemy below (HP=${e2.health})`
    );

    // Move left (faces west) and fire laser -> should hit e3 at (3, 7)
    await controller.executeCommand('move_left', [], 5);
    assert(
      controller.gameState.player.facing === 'west',
      'move_left() updates player facing to west'
    );
    await controller.executeCommand('laser', [], 6);
    assert(
      e3.health < 60,
      `West-facing laser() hits enemy to the left (HP=${e3.health})`
    );

    // 11. TEST SHOCKWAVE ATTACK (Range, Damage, Player Safety & Cooldown)
    controller.reset();
    controller.startSimulation();
    controller.gameState.player.x = 7;
    controller.gameState.player.y = 7;
    const nearEnemy = controller.gameState.enemies[0];
    const farEnemy = controller.gameState.enemies[1];
    nearEnemy.x = 8;
    nearEnemy.y = 7; // distance 1 (inside radius 2)
    nearEnemy.health = 60;
    farEnemy.x = 12;
    farEnemy.y = 7; // distance 5 (outside radius 2)
    farEnemy.health = 60;

    const swRes1 = await controller.executeCommand('shockwave', [], 1);
    assert(
      swRes1.success &&
        nearEnemy.health === 35 &&
        farEnemy.health === 60 &&
        controller.gameState.player.health === 100,
      `shockwave() damages enemy within radius (HP=${nearEnemy.health}), ignores far enemy (HP=${farEnemy.health}), and does not hurt player`
    );

    // Immediate second shockwave should be blocked by 5s cooldown
    const swRes2 = await controller.executeCommand('shockwave', [], 2);
    assert(
      !swRes2.success && Boolean(swRes2.message?.includes('cooldown')),
      `shockwave() respects 5s cooldown when called immediately: '${swRes2.message}'`
    );

    // Advance simulation by 5.1s and verify shockwave is ready again
    for (let i = 0; i < 55; i++) {
      simTime += 100;
      controller.updateSimulation(simTime, 100);
    }
    const swRes3 = await controller.executeCommand('shockwave', [], 3);
    assert(
      swRes3.success && nearEnemy.health === 10,
      `shockwave() succeeds after 5s cooldown expires (enemy HP=${nearEnemy.health})`
    );

    // =========================================================================
    // 12. TEST LOCAL HOT-SEAT PvP MODE: CONTINUOUS ROUND-BASED BATTLES
    //     (5-Slot Validator, Independent Interpreters, Simultaneous Execution,
    //      wait(n), Persistent State, Multi-Round Progression, Timeout & Rematch)
    // =========================================================================

    // A. PvP Validator: 5-slot per-round limit & restricted command set
    const validPvP = validatePvPProgram(
      `move_right()\nlaser()\nbomb(7, 7)\nshockwave()\nwait(2)`
    );
    assert(
      validPvP.valid && validPvP.instructions.length === 5,
      'PvP Validator: accepts valid 5-instruction program (movement, laser, bomb, shockwave, wait)'
    );

    const sixLines = Array.from({ length: 6 }, () => 'move_right()').join('\n');
    const overSlotLimit = validatePvPProgram(sixLines);
    assert(
      !overSlotLimit.valid && overSlotLimit.error?.line === 6,
      `PvP Validator: rejects >5 instructions with line 6 error ('${overSlotLimit.error?.message}')`
    );

    const loopRejected = validatePvPProgram('for i in range(3):\n    move_up()');
    assert(
      !loopRejected.valid && loopRejected.error?.line === 1,
      `PvP Validator: rejects loops in PvP mode ('${loopRejected.error?.message}')`
    );

    const condRejected = validatePvPProgram('if player_hp > 50:\n    laser()');
    assert(
      !condRejected.valid && condRejected.error?.line === 1,
      `PvP Validator: rejects conditionals in PvP mode ('${condRejected.error?.message}')`
    );

    const oobBombRejected = validatePvPProgram('bomb(20, 20)');
    assert(
      !oobBombRejected.valid && oobBombRejected.error?.line === 1,
      `PvP Validator: rejects out-of-bounds bomb coordinates ('${oobBombRejected.error?.message}')`
    );

    const badWaitRejected = validatePvPProgram('wait(0)');
    assert(
      !badWaitRejected.valid && badWaitRejected.error?.line === 1,
      `PvP Validator: rejects wait(0) outside 1..10 range ('${badWaitRejected.error?.message}')`
    );

    // B. Two Independent Interpreters & Simultaneous Execution with wait(n)
    let pvpSimFrameTime = 0;
    const stepPvP = (ctrl: PvPBattleController, totalMs: number) => {
      let rem = totalMs;
      while (rem > 0) {
        const dt = Math.min(100, rem);
        rem -= dt;
        pvpSimFrameTime += dt;
        ctrl.updateSimulation(pvpSimFrameTime, dt);
      }
    };

    const pvpController = new PvPBattleController({}, DEFAULT_PVP_CONFIG);

    // P1 waits 2 seconds then fires laser; P2 moves left twice then fires laser
    const p1Prog = validatePvPProgram('wait(2)\nlaser()').instructions;
    const p2Prog = validatePvPProgram('move_left()\nmove_left()\nlaser()').instructions;

    pvpController.startBattle(p1Prog, p2Prog, 'Alpha', 'Omega');

    const initialPvPSnap = pvpController.getSnapshot();
    assert(
      initialPvPSnap.currentRound === 1 &&
        initialPvPSnap.p1.x === 2 &&
        initialPvPSnap.p1.y === 7 &&
        initialPvPSnap.p1.facing === 'east' &&
        initialPvPSnap.p2.x === 12 &&
        initialPvPSnap.p2.y === 7 &&
        initialPvPSnap.p2.facing === 'west',
      'PvP Battle: Round 1 starts with P1 at (2,7) facing east and P2 at (12,7) facing west'
    );

    // Advance 700ms (step 1): P1 executes wait(2) (nextActionTimeMs becomes 700 + 2000 = 2700ms),
    // while P2 moves left to (11, 7)
    stepPvP(pvpController, 700);
    const snapAfterStep1 = pvpController.getSnapshot();
    assert(
      snapAfterStep1.p1.x === 2 &&
        snapAfterStep1.p2.x === 11 &&
        snapAfterStep1.p1.lastActionText.includes('Waiting (2s)') &&
        snapAfterStep1.p2.lastActionText.includes('Moved Left'),
      `PvP Independent Scheduling: at 700ms P1 executes wait(2) while P2 moves to (${snapAfterStep1.p2.x}, ${snapAfterStep1.p2.y})`
    );

    // Advance another 700ms (total 1400ms): P1 is still waiting (until 2700ms), while P2 moves left again to (10, 7)!
    stepPvP(pvpController, 700);
    const snapAfterStep2 = pvpController.getSnapshot();
    assert(
      snapAfterStep2.p1.instructionPointer === 1 &&
        snapAfterStep2.p2.x === 10 &&
        snapAfterStep2.p2.instructionPointer === 2,
      'PvP wait(n) Isolation: P2 continues executing instructions at 1400ms while P1 waits'
    );

    // Advance another 700ms (total 2100ms): P2 fires laser() westward along row 7 and hits P1 at (2, 7)!
    stepPvP(pvpController, 700);
    const snapAfterStep3 = pvpController.getSnapshot();
    assert(
      snapAfterStep3.p1.health === 65 &&
        snapAfterStep3.p2.stats.laserHits === 1 &&
        snapAfterStep3.p2.stats.damageDealt === 35 &&
        snapAfterStep3.p2.executionState === 'FINISHED',
      `PvP Combat & Completion Isolation: P2 laser hits P1 (HP=${snapAfterStep3.p1.health}) and P2 finishes while P1 is still running`
    );

    // Advance another 600ms (total 2700ms): P1's wait(2) finishes and P1 fires laser() eastward, hitting P2 at (10, 7)!
    stepPvP(pvpController, 600);
    const snapAfterP1Laser = pvpController.getSnapshot();
    assert(
      snapAfterP1Laser.p2.health === 65 &&
        snapAfterP1Laser.p1.stats.laserHits === 1 &&
        snapAfterP1Laser.p1.executionState === 'FINISHED',
      `PvP Continued Execution: P1 finishes wait(2) at 2700ms and hits P2 with laser (P2 HP=${snapAfterP1Laser.p2.health})`
    );

    // Settle round 1 (extra 500ms): round finishes and signals completion
    stepPvP(pvpController, 600);
    const snapRound1Done = pvpController.getSnapshot();
    assert(
      snapRound1Done.isRoundFinished && !snapRound1Done.isBattleFinished,
      'PvP Round Completion: Round 1 finishes when both programs complete, without ending the match'
    );

    // C. Test Multi-Round State Persistence & Round 2 Execution
    pvpController.advanceToNextRound();
    const snapRound2Start = pvpController.getSnapshot();
    assert(
      snapRound2Start.currentRound === 2 &&
        snapRound2Start.p1.health === 65 &&
        snapRound2Start.p2.health === 65 &&
        snapRound2Start.p1.x === 2 &&
        snapRound2Start.p2.x === 10,
      'PvP Round 2 Progression: preserves robot health (65/65) and positions (2,7 and 10,7) across rounds'
    );

    // Execute Round 2 with fresh programs: P1 moves right, P2 moves left
    const p1ProgR2 = validatePvPProgram('move_right()\nlaser()').instructions;
    const p2ProgR2 = validatePvPProgram('move_left()\nshockwave()').instructions;
    pvpController.startRoundBattle(p1ProgR2, p2ProgR2);
    stepPvP(pvpController, 1400);
    const snapRound2Step = pvpController.getSnapshot();
    assert(
      snapRound2Step.p1.x === 3 && snapRound2Step.p2.x === 9,
      `PvP Round 2 Fresh Strategy: P1 advances to x=${snapRound2Step.p1.x} and P2 advances to x=${snapRound2Step.p2.x}`
    );

    // D. Test 60-Second Battle Timeout Winner Resolution
    pvpController.resetMatch('P1', 'P2');
    const timeoutProg1 = validatePvPProgram('laser()').instructions;
    const timeoutWaitProg2 = validatePvPProgram('wait(1)').instructions;
    pvpController.startRoundBattle(timeoutProg1, timeoutWaitProg2);
    stepPvP(pvpController, 60000);
    const timeoutSnap = pvpController.getSnapshot();
    assert(
      timeoutSnap.isBattleFinished &&
        timeoutSnap.winner === 'P1' &&
        timeoutSnap.endReason === 'TIMEOUT' &&
        timeoutSnap.p1.health === 100 &&
        timeoutSnap.p2.health === 65,
      `PvP Timeout Resolution: P1 wins on 60s timeout with higher remaining HP (${timeoutSnap.p1.health} vs ${timeoutSnap.p2.health})`
    );

    // E. Test Simultaneous Knockout (Fair Draw without P1/P2 Order Bias)
    pvpController.resetMatch('Blue', 'Crimson');
    const koProg = validatePvPProgram(
      'laser()\nlaser()\nlaser()\nlaser()'
    ).instructions;
    pvpController.startRoundBattle(koProg, koProg);
    stepPvP(pvpController, 5000);
    const doubleKoSnap = pvpController.getSnapshot();
    assert(
      doubleKoSnap.isBattleFinished &&
        doubleKoSnap.winner === 'DRAW' &&
        doubleKoSnap.endReason === 'DOUBLE_KO' &&
        doubleKoSnap.p1.health === 0 &&
        doubleKoSnap.p2.health === 0,
      `PvP Fair Simultaneous Resolution: mutual lethal lasers in the same tick result in DRAW (DOUBLE_KO)`
    );

    // F. Test Bomb & Shockwave in PvP + Rematch Reset
    pvpController.resetMatch('P1', 'P2');
    const closeCombatP1 = validatePvPProgram(
      'move_right()\nmove_right()\nmove_right()\nbomb(7, 7)\nshockwave()'
    ).instructions;
    const closeCombatP2 = validatePvPProgram(
      'move_left()\nmove_left()\nmove_left()\nwait(1)'
    ).instructions;
    pvpController.startRoundBattle(closeCombatP1, closeCombatP2);
    stepPvP(pvpController, 4200);
    const afterSwSnap = pvpController.getSnapshot();
    assert(
      afterSwSnap.p1.stats.bombsPlaced === 1 &&
        afterSwSnap.p1.stats.shockwavesUsed === 1 &&
        afterSwSnap.p2.health === 75 &&
        afterSwSnap.p1.health === 100,
      `PvP Bomb & Shockwave: P1 places bomb and hits P2 with shockwave (P2 HP=${afterSwSnap.p2.health}, P1 HP=${afterSwSnap.p1.health})`
    );

    // Test Rematch / Reset restores full health, starting spawns, round 1
    pvpController.resetMatch('P1', 'P2');
    const rematchSnap = pvpController.getSnapshot();
    assert(
      rematchSnap.currentRound === 1 &&
        rematchSnap.p1.health === 100 &&
        rematchSnap.p2.health === 100 &&
        rematchSnap.p1.x === 2 &&
        rematchSnap.p2.x === 12 &&
        rematchSnap.bombs.length === 0,
      'PvP Rematch Reset: restores Round 1, both robots to 100 HP, starting positions, and clears bombs'
    );
  }

  return { passed: allPassed, results };
}

