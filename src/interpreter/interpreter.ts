import {
  ExpressionNode,
  InterpreterError,
  ProgramNode,
  StatementNode,
} from './ast';
import {
  IGameAPI,
  SUPPORTED_VARIABLES,
  SupportedCommandName,
  SupportedVariableName,
} from './gameApi';

export interface StepEvent {
  kind: 'control' | 'command';
  line: number;
  instructionText: string;
  commandName?: SupportedCommandName;
  args?: number[];
}

export interface InterpreterCallbacks {
  onInstructionChange?: (line: number | null, text: string | null) => void;
  onLog?: (
    message: string,
    type: 'info' | 'command' | 'warning' | 'error' | 'success',
    line?: number
  ) => void;
  onStatusChange?: (status: 'READY' | 'RUNNING' | 'STOPPED' | 'ERROR') => void;
}

const MAX_CONTROL_OPS_PER_TICK = 64;
const MAX_EMPTY_TICKS_BEFORE_HALT = 4;
const MAX_RANGE_LIMIT = 500;
const MAX_TOTAL_TICKS = 2000;

export class CodeInterpreter {
  private gameApi: IGameAPI;
  private callbacks: InterpreterCallbacks;
  private localEnv: Map<string, number> = new Map();
  private generator: Generator<StepEvent, void, void> | null = null;
  private running = false;
  private cancelled = false;
  private waitTicksRemaining = 0;
  private consecutiveEmptyTicks = 0;
  private totalTicks = 0;
  private currentLine: number | null = null;

  constructor(gameApi: IGameAPI, callbacks: InterpreterCallbacks = {}) {
    this.gameApi = gameApi;
    this.callbacks = callbacks;
  }

  public start(ast: ProgramNode): void {
    this.stop(true);
    this.localEnv.clear();
    this.running = true;
    this.cancelled = false;
    this.waitTicksRemaining = 0;
    this.consecutiveEmptyTicks = 0;
    this.totalTicks = 0;
    this.currentLine = null;
    this.generator = this.executeBlock(ast.body, 0);
  }

  public stop(silent = false): void {
    const wasRunning = this.running;
    this.running = false;
    this.cancelled = true;
    this.generator = null;
    this.waitTicksRemaining = 0;
    this.callbacks.onInstructionChange?.(null, null);

    if (wasRunning && !silent) {
      this.callbacks.onLog?.('Program stopped.', 'warning');
      this.callbacks.onStatusChange?.('STOPPED');
    }
  }

  public isRunning(): boolean {
    return this.running && !this.cancelled;
  }

  /**
   * Executes a single simulation tick.
   * Returns true if program is still active, false if finished or halted.
   */
  public async stepTick(): Promise<boolean> {
    if (!this.running || this.cancelled || !this.generator) {
      return false;
    }

    this.totalTicks++;
    if (this.totalTicks > MAX_TOTAL_TICKS) {
      this.running = false;
      this.callbacks.onInstructionChange?.(null, null);
      this.callbacks.onLog?.(
        `Execution halted: Maximum tick budget (${MAX_TOTAL_TICKS}) reached.`,
        'warning'
      );
      this.callbacks.onStatusChange?.('STOPPED');
      return false;
    }

    // Handle active wait() countdown ticks
    if (this.waitTicksRemaining > 0) {
      this.waitTicksRemaining--;
      return true;
    }

    try {
      let controlOps = 0;

      while (controlOps < MAX_CONTROL_OPS_PER_TICK) {
        if (this.cancelled || !this.running) {
          return false;
        }

        const next = this.generator.next();

        if (next.done) {
          this.running = false;
          this.callbacks.onInstructionChange?.(null, null);
          this.callbacks.onLog?.('Program completed.', 'success');
          this.callbacks.onStatusChange?.('READY');
          return false;
        }

        const event = next.value;
        this.currentLine = event.line;
        this.callbacks.onInstructionChange?.(event.line, event.instructionText);

        if (event.kind === 'command' && event.commandName) {
          this.consecutiveEmptyTicks = 0;
          const args = event.args ?? [];
          const result = await this.gameApi.executeCommand(
            event.commandName,
            args,
            event.line
          );

          if (this.cancelled || !this.running) {
            return false;
          }

          if (result.message) {
            this.callbacks.onLog?.(
              result.message,
              result.success ? 'command' : 'warning',
              event.line
            );
          } else {
            this.callbacks.onLog?.(
              `${result.formattedCall} executed.`,
              'command',
              event.line
            );
          }

          if (event.commandName === 'wait') {
            const requestedTicks = Math.max(1, Math.min(20, Math.floor(args[0] ?? 1)));
            // 1 tick is consumed now; any additional ticks are waited on subsequent cycles
            this.waitTicksRemaining = Math.max(0, requestedTicks - 1);
          }

          return true;
        }

        controlOps++;
      }

      // If we exhausted MAX_CONTROL_OPS_PER_TICK without hitting a command
      this.consecutiveEmptyTicks++;
      if (this.consecutiveEmptyTicks >= MAX_EMPTY_TICKS_BEFORE_HALT) {
        this.running = false;
        this.callbacks.onInstructionChange?.(null, null);
        this.callbacks.onLog?.(
          `Execution halted on line ${this.currentLine ?? 1}: Infinite loop without game actions detected.`,
          'error',
          this.currentLine ?? 1
        );
        this.callbacks.onStatusChange?.('ERROR');
        return false;
      }

      return true;
    } catch (err) {
      this.running = false;
      this.callbacks.onInstructionChange?.(null, null);
      const line = err instanceof InterpreterError ? err.line : this.currentLine ?? 1;
      const msg = err instanceof Error ? err.message : 'Runtime execution error';
      this.callbacks.onLog?.(`Error on line ${line}: ${msg}`, 'error', line);
      this.callbacks.onStatusChange?.('ERROR');
      return false;
    }
  }

  private *executeBlock(
    statements: StatementNode[],
    loopDepth: number
  ): Generator<StepEvent, void, void> {
    for (const stmt of statements) {
      if (this.cancelled) return;
      yield* this.executeStatement(stmt, loopDepth);
    }
  }

  private *executeStatement(
    stmt: StatementNode,
    loopDepth: number
  ): Generator<StepEvent, void, void> {
    if (this.cancelled) return;

    switch (stmt.kind) {
      case 'CommandStatement': {
        const evaluatedArgs = stmt.args.map((arg) =>
          Number(this.evaluateExpression(arg))
        );
        const formattedArgs = evaluatedArgs.join(', ');
        const instructionText = `${stmt.name}(${formattedArgs})`;

        yield {
          kind: 'command',
          line: stmt.line,
          instructionText,
          commandName: stmt.name as SupportedCommandName,
          args: evaluatedArgs,
        };
        break;
      }

      case 'AssignmentStatement': {
        const val = Number(this.evaluateExpression(stmt.value));
        this.localEnv.set(stmt.name, val);
        yield {
          kind: 'control',
          line: stmt.line,
          instructionText: `${stmt.name} = ${val}`,
        };
        break;
      }

      case 'IfStatement': {
        const condResult = Boolean(this.evaluateExpression(stmt.condition));
        yield {
          kind: 'control',
          line: stmt.line,
          instructionText: `if (${condResult ? 'True' : 'False'})`,
        };
        if (condResult) {
          yield* this.executeBlock(stmt.consequent, loopDepth);
        } else if (stmt.alternate) {
          yield* this.executeBlock(stmt.alternate, loopDepth);
        }
        break;
      }

      case 'WhileStatement': {
        while (!this.cancelled) {
          const condResult = Boolean(this.evaluateExpression(stmt.condition));
          yield {
            kind: 'control',
            line: stmt.line,
            instructionText: `while (${condResult ? 'True' : 'False'})`,
          };
          if (!condResult) {
            break;
          }
          yield* this.executeBlock(stmt.body, loopDepth + 1);
        }
        break;
      }

      case 'ForRangeStatement': {
        const rawArgs = stmt.args.map((arg) => this.evaluateExpression(arg));
        for (const val of rawArgs) {
          if (typeof val !== 'number' || !Number.isInteger(val)) {
            throw new InterpreterError(
              'range() arguments must be integers',
              stmt.line
            );
          }
        }

        const numArgs = rawArgs as number[];
        let start = 0;
        let stop = 0;
        let step = 1;

        if (numArgs.length === 1) {
          stop = numArgs[0];
        } else if (numArgs.length === 2) {
          start = numArgs[0];
          stop = numArgs[1];
        } else if (numArgs.length === 3) {
          start = numArgs[0];
          stop = numArgs[1];
          step = numArgs[2];
        } else {
          throw new InterpreterError(
            `Invalid argument count for range(): expected 1 to 3 arguments, got ${numArgs.length}`,
            stmt.line
          );
        }

        if (step === 0) {
          throw new InterpreterError(
            'range() arg 3 (step) must not be zero',
            stmt.line
          );
        }

        const rangeLabel = `range(${numArgs.join(', ')})`;
        let iterations = 0;

        for (
          let current = start;
          step > 0 ? current < stop : current > stop;
          current += step
        ) {
          if (this.cancelled) break;
          if (iterations >= MAX_RANGE_LIMIT) break;
          iterations++;

          this.localEnv.set(stmt.iterator, current);
          yield {
            kind: 'control',
            line: stmt.line,
            instructionText: `for ${stmt.iterator} = ${current} in ${rangeLabel}`,
          };
          yield* this.executeBlock(stmt.body, loopDepth + 1);
        }
        break;
      }
    }
  }

  private evaluateExpression(expr: ExpressionNode): number | boolean {
    switch (expr.kind) {
      case 'NumberLiteral':
        return expr.value;

      case 'BooleanLiteral':
        return expr.value;

      case 'Variable': {
        if (SUPPORTED_VARIABLES.has(expr.name)) {
          return this.gameApi.getVariable(expr.name as SupportedVariableName);
        }
        if (this.localEnv.has(expr.name)) {
          return this.localEnv.get(expr.name)!;
        }
        throw new InterpreterError(
          `Undefined variable: ${expr.name}`,
          expr.line
        );
      }

      case 'UnaryExpression': {
        const val = this.evaluateExpression(expr.argument);
        if (expr.operator === '-') {
          return -Number(val);
        }
        return !val;
      }

      case 'BinaryExpression': {
        const left = this.evaluateExpression(expr.left);
        const right = this.evaluateExpression(expr.right);

        switch (expr.operator) {
          case '+':
            return Number(left) + Number(right);
          case '-':
            return Number(left) - Number(right);
          case '*':
            return Number(left) * Number(right);
          case '/': {
            const divisor = Number(right);
            if (divisor === 0) {
              throw new InterpreterError('Division by zero', expr.line);
            }
            return Math.floor(Number(left) / divisor);
          }
          case '>':
            return Number(left) > Number(right);
          case '<':
            return Number(left) < Number(right);
          case '>=':
            return Number(left) >= Number(right);
          case '<=':
            return Number(left) <= Number(right);
          case '==':
            return left === right;
          case '!=':
            return left !== right;
          case 'and':
            return Boolean(left) && Boolean(right);
          case 'or':
            return Boolean(left) || Boolean(right);
        }
      }
    }
  }
}

