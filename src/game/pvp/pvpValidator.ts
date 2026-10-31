import { InterpreterError, ExpressionNode } from '../../interpreter/ast';
import {
  SUPPORTED_COMMANDS,
  SupportedCommandName,
} from '../../interpreter/gameApi';
import { tokenize } from '../../interpreter/lexer';
import { parse } from '../../interpreter/parser';
import {
  DEFAULT_PVP_CONFIG,
  PvPInstruction,
  PvPMatchConfig,
  PvPValidationResult,
} from './pvpTypes';

/**
 * Validates a player's PvP program according to the Local PvP rules:
 * - Only the 8 supported commands are allowed:
 *   move_up(), move_down(), move_left(), move_right(),
 *   laser(), bomb(x, y), shockwave(), wait(n)
 * - Maximum 12 instruction slots per player.
 * - Rejects loops (for, while), conditionals (if, else), variable assignments,
 *   and arbitrary expressions.
 * - Validates bomb(x, y) coordinates against arena boundaries (0..gridSize-1).
 * - Validates wait(n) against sensible wait limits (1..10 seconds).
 */
export function validatePvPProgram(
  source: string,
  config: PvPMatchConfig = DEFAULT_PVP_CONFIG,
  allowEmpty = false
): PvPValidationResult {
  const maxSlots = config.maxInstructionSlots;

  // Check if source is empty or comments-only
  const trimmedNonCommentLines = source
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);

  if (trimmedNonCommentLines.length === 0) {
    if (allowEmpty) {
      return {
        valid: true,
        instructions: [],
        instructionCount: 0,
        remainingSlots: maxSlots,
        error: null,
      };
    }
    return {
      valid: false,
      instructions: [],
      instructionCount: 0,
      remainingSlots: maxSlots,
      error: {
        line: 1,
        message: 'Program contains no instructions. Write at least 1 command.',
      },
    };
  }

  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    const instructions: PvPInstruction[] = [];

    for (const stmt of ast.body) {
      if (stmt.kind === 'ForRangeStatement' || stmt.kind === 'WhileStatement') {
        throw new InterpreterError(
          'Loops (for / while) are not allowed in Local PvP mode',
          stmt.line
        );
      }

      if (stmt.kind === 'IfStatement') {
        throw new InterpreterError(
          'Conditional statements (if / else) are not allowed in Local PvP mode',
          stmt.line
        );
      }

      if (stmt.kind === 'AssignmentStatement') {
        throw new InterpreterError(
          'Variable assignments are not allowed in Local PvP mode',
          stmt.line
        );
      }

      if (stmt.kind === 'CommandStatement') {
        const cmdSpec =
          SUPPORTED_COMMANDS[stmt.name as SupportedCommandName];
        if (!cmdSpec) {
          throw new InterpreterError(
            `Unknown command: ${stmt.name}()`,
            stmt.line
          );
        }

        if (stmt.args.length !== cmdSpec.arity) {
          throw new InterpreterError(
            `Invalid argument count for ${cmdSpec.signature}: expected ${cmdSpec.arity}, got ${stmt.args.length}`,
            stmt.line
          );
        }

        const evaluatedArgs: number[] = [];
        for (const argExpr of stmt.args) {
          const intVal = evaluateIntegerLiteral(argExpr, stmt.line);
          evaluatedArgs.push(intVal);
        }

        if (stmt.name === 'bomb') {
          const [bx, by] = evaluatedArgs;
          if (
            bx < 0 ||
            bx >= config.gridSize ||
            by < 0 ||
            by >= config.gridSize
          ) {
            throw new InterpreterError(
              `bomb(${bx}, ${by}) coordinates must be within arena bounds (0 to ${
                config.gridSize - 1
              })`,
              stmt.line
            );
          }
        }

        if (stmt.name === 'wait') {
          const [waitSec] = evaluatedArgs;
          if (
            waitSec < config.waitMinSeconds ||
            waitSec > config.waitMaxSeconds
          ) {
            throw new InterpreterError(
              `wait(${waitSec}) must be between ${config.waitMinSeconds} and ${config.waitMaxSeconds} seconds`,
              stmt.line
            );
          }
        }

        instructions.push({
          command: stmt.name as SupportedCommandName,
          args: evaluatedArgs,
          line: stmt.line,
          formatted: `${stmt.name}(${evaluatedArgs.join(', ')})`,
        });
      }
    }

    if (instructions.length > maxSlots) {
      const overflowInstr = instructions[maxSlots];
      throw new InterpreterError(
        `Instruction limit exceeded: maximum ${maxSlots} instructions allowed (found ${instructions.length})`,
        overflowInstr.line
      );
    }

    return {
      valid: true,
      instructions,
      instructionCount: instructions.length,
      remainingSlots: Math.max(0, maxSlots - instructions.length),
      error: null,
    };
  } catch (err) {
    const line = err instanceof InterpreterError ? err.line : 1;
    const message =
      err instanceof Error ? err.message : 'Invalid syntax in PvP program';

    // Best-effort instruction count for UI slot indicator even when an error exists
    const approxCount = trimmedNonCommentLines.length;

    return {
      valid: false,
      instructions: [],
      instructionCount: approxCount,
      remainingSlots: Math.max(0, maxSlots - approxCount),
      error: {
        line,
        message,
      },
    };
  }
}

function evaluateIntegerLiteral(expr: ExpressionNode, line: number): number {
  if (expr.kind === 'NumberLiteral') {
    if (!Number.isInteger(expr.value)) {
      throw new InterpreterError('Command arguments must be integers', line);
    }
    return expr.value;
  }
  if (
    expr.kind === 'UnaryExpression' &&
    expr.operator === '-' &&
    expr.argument.kind === 'NumberLiteral'
  ) {
    const val = -expr.argument.value;
    if (!Number.isInteger(val)) {
      throw new InterpreterError('Command arguments must be integers', line);
    }
    return val;
  }
  throw new InterpreterError(
    'Arbitrary expressions and variables are not allowed in Local PvP arguments; use integer numbers',
    line
  );
}

