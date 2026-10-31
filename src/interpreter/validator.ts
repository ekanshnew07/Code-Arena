import {
  ExpressionNode,
  InterpreterError,
  ProgramNode,
  StatementNode,
} from './ast';
import {
  SUPPORTED_COMMANDS,
  SUPPORTED_VARIABLES,
  SupportedCommandName,
} from './gameApi';
import { tokenize } from './lexer';
import { parse } from './parser';

export const MAX_LOOP_NESTING_DEPTH = 5;

export interface ValidationResult {
  valid: boolean;
  ast?: ProgramNode;
  error?: {
    line: number;
    message: string;
  };
}

export function validateAST(program: ProgramNode): void {
  if (program.body.length === 0) {
    throw new InterpreterError('Program contains no executable instructions', 1);
  }

  const definedVars = new Set<string>(SUPPORTED_VARIABLES);
  validateStatements(program.body, definedVars, 0);
}

function validateStatements(
  statements: StatementNode[],
  scopeVars: Set<string>,
  loopDepth: number
): void {
  for (const stmt of statements) {
    switch (stmt.kind) {
      case 'CommandStatement': {
        const cmdSpec =
          SUPPORTED_COMMANDS[stmt.name as SupportedCommandName];
        if (!cmdSpec) {
          throw new InterpreterError(
            `Unknown command: ${stmt.name}()`,
            stmt.line
          );
        }

        // Validate argument expressions first so undefined variables (e.g., move_right(speed)) are caught clearly
        for (const arg of stmt.args) {
          validateExpression(arg, scopeVars);
        }

        if (stmt.args.length !== cmdSpec.arity) {
          throw new InterpreterError(
            `Invalid argument count for ${cmdSpec.signature}: expected ${cmdSpec.arity}, got ${stmt.args.length}`,
            stmt.line
          );
        }
        break;
      }

      case 'AssignmentStatement': {
        validateExpression(stmt.value, scopeVars);
        scopeVars.add(stmt.name);
        break;
      }

      case 'IfStatement': {
        validateExpression(stmt.condition, scopeVars);
        validateStatements(stmt.consequent, new Set(scopeVars), loopDepth);
        if (stmt.alternate) {
          validateStatements(stmt.alternate, new Set(scopeVars), loopDepth);
        }
        break;
      }

      case 'WhileStatement': {
        const nextDepth = loopDepth + 1;
        if (nextDepth > MAX_LOOP_NESTING_DEPTH) {
          throw new InterpreterError(
            `Maximum loop nesting depth (${MAX_LOOP_NESTING_DEPTH}) exceeded`,
            stmt.line
          );
        }
        validateExpression(stmt.condition, scopeVars);
        validateStatements(stmt.body, new Set(scopeVars), nextDepth);
        break;
      }

      case 'ForRangeStatement': {
        const nextDepth = loopDepth + 1;
        if (nextDepth > MAX_LOOP_NESTING_DEPTH) {
          throw new InterpreterError(
            `Maximum loop nesting depth (${MAX_LOOP_NESTING_DEPTH}) exceeded`,
            stmt.line
          );
        }
        for (const arg of stmt.args) {
          validateExpression(arg, scopeVars);
        }
        if (stmt.args.length < 1 || stmt.args.length > 3) {
          throw new InterpreterError(
            `Invalid argument count for range(): expected 1 to 3 arguments, got ${stmt.args.length}`,
            stmt.line
          );
        }
        for (const arg of stmt.args) {
          validateIntegerExpression(arg, stmt.line);
        }
        if (stmt.args.length === 3) {
          const stepVal = tryEvaluateConstantNumber(stmt.args[2]);
          if (stepVal !== null && stepVal === 0) {
            throw new InterpreterError(
              'range() arg 3 (step) must not be zero',
              stmt.line
            );
          }
        }
        const bodyScope = new Set(scopeVars);
        bodyScope.add(stmt.iterator);
        validateStatements(stmt.body, bodyScope, nextDepth);
        break;
      }
    }
  }
}

function validateExpression(
  expr: ExpressionNode,
  scopeVars: Set<string>
): void {
  switch (expr.kind) {
    case 'NumberLiteral':
    case 'BooleanLiteral':
      return;

    case 'Variable': {
      if (!scopeVars.has(expr.name)) {
        throw new InterpreterError(
          `Undefined variable: ${expr.name}`,
          expr.line
        );
      }
      return;
    }

    case 'UnaryExpression': {
      validateExpression(expr.argument, scopeVars);
      return;
    }

    case 'BinaryExpression': {
      validateExpression(expr.left, scopeVars);
      validateExpression(expr.right, scopeVars);
      return;
    }
  }
}

function validateIntegerExpression(expr: ExpressionNode, line: number): void {
  switch (expr.kind) {
    case 'BooleanLiteral':
      throw new InterpreterError('range() arguments must be integers', line);
    case 'NumberLiteral':
      if (!Number.isInteger(expr.value)) {
        throw new InterpreterError('range() arguments must be integers', line);
      }
      return;
    case 'Variable':
      return;
    case 'UnaryExpression':
      if (expr.operator === 'not') {
        throw new InterpreterError('range() arguments must be integers', line);
      }
      validateIntegerExpression(expr.argument, line);
      return;
    case 'BinaryExpression':
      if (
        expr.operator === '>' ||
        expr.operator === '<' ||
        expr.operator === '>=' ||
        expr.operator === '<=' ||
        expr.operator === '==' ||
        expr.operator === '!=' ||
        expr.operator === 'and' ||
        expr.operator === 'or'
      ) {
        throw new InterpreterError('range() arguments must be integers', line);
      }
      validateIntegerExpression(expr.left, line);
      validateIntegerExpression(expr.right, line);
      return;
  }
}

function tryEvaluateConstantNumber(expr: ExpressionNode): number | null {
  switch (expr.kind) {
    case 'NumberLiteral':
      return expr.value;
    case 'UnaryExpression':
      if (expr.operator === '-') {
        const inner = tryEvaluateConstantNumber(expr.argument);
        return inner !== null ? -inner : null;
      }
      return null;
    case 'BinaryExpression': {
      const l = tryEvaluateConstantNumber(expr.left);
      const r = tryEvaluateConstantNumber(expr.right);
      if (l === null || r === null) return null;
      switch (expr.operator) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r !== 0 ? Math.floor(l / r) : null;
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

export function compileAndValidate(source: string): ValidationResult {
  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    validateAST(ast);
    return {
      valid: true,
      ast,
    };
  } catch (err) {
    if (err instanceof InterpreterError) {
      return {
        valid: false,
        error: {
          line: err.line,
          message: err.message,
        },
      };
    }
    return {
      valid: false,
      error: {
        line: 1,
        message: err instanceof Error ? err.message : 'Unknown syntax error',
      },
    };
  }
}

