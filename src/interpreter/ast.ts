export type TokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'OPERATOR'
  | 'ASSIGN'
  | 'LPAREN'
  | 'RPAREN'
  | 'COLON'
  | 'COMMA'
  | 'NEWLINE'
  | 'INDENT'
  | 'DEDENT'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export type ComparisonOperator = '>' | '<' | '>=' | '<=' | '==' | '!=';
export type ArithmeticOperator = '+' | '-' | '*' | '/';
export type BinaryOperator = ComparisonOperator | ArithmeticOperator | 'and' | 'or';

export type ExpressionNode =
  | NumberLiteralNode
  | BooleanLiteralNode
  | VariableNode
  | BinaryExpressionNode
  | UnaryExpressionNode;

export interface NumberLiteralNode {
  kind: 'NumberLiteral';
  value: number;
  line: number;
}

export interface BooleanLiteralNode {
  kind: 'BooleanLiteral';
  value: boolean;
  line: number;
}

export interface VariableNode {
  kind: 'Variable';
  name: string;
  line: number;
}

export interface BinaryExpressionNode {
  kind: 'BinaryExpression';
  operator: BinaryOperator;
  left: ExpressionNode;
  right: ExpressionNode;
  line: number;
}

export interface UnaryExpressionNode {
  kind: 'UnaryExpression';
  operator: '-' | 'not';
  argument: ExpressionNode;
  line: number;
}

export type StatementNode =
  | CommandStatementNode
  | IfStatementNode
  | WhileStatementNode
  | ForRangeStatementNode
  | AssignmentStatementNode;

export interface CommandStatementNode {
  kind: 'CommandStatement';
  name: string;
  args: ExpressionNode[];
  line: number;
}

export interface IfStatementNode {
  kind: 'IfStatement';
  condition: ExpressionNode;
  consequent: StatementNode[];
  alternate: StatementNode[] | null;
  line: number;
}

export interface WhileStatementNode {
  kind: 'WhileStatement';
  condition: ExpressionNode;
  body: StatementNode[];
  line: number;
}

export interface ForRangeStatementNode {
  kind: 'ForRangeStatement';
  iterator: string;
  args: ExpressionNode[];
  body: StatementNode[];
  line: number;
}

export interface AssignmentStatementNode {
  kind: 'AssignmentStatement';
  name: string;
  value: ExpressionNode;
  line: number;
}

export interface ProgramNode {
  kind: 'Program';
  body: StatementNode[];
}

export class InterpreterError extends Error {
  public readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = 'InterpreterError';
    this.line = line;
  }
}

