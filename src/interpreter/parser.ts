import {
  BinaryOperator,
  ExpressionNode,
  InterpreterError,
  ProgramNode,
  StatementNode,
  Token,
  TokenType,
} from './ast';

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public parseProgram(): ProgramNode {
    const body: StatementNode[] = [];

    this.skipNewlines();
    while (!this.isAtEnd()) {
      if (this.check('DEDENT')) {
        const tok = this.peek();
        throw new InterpreterError(`Syntax error on line ${tok.line}`, tok.line);
      }
      body.push(this.parseStatement());
      this.skipNewlines();
    }

    return {
      kind: 'Program',
      body,
    };
  }

  private parseStatement(): StatementNode {
    const token = this.peek();

    if (token.type === 'KEYWORD') {
      if (token.value === 'if') {
        return this.parseIfStatement();
      }
      if (token.value === 'while') {
        return this.parseWhileStatement();
      }
      if (token.value === 'for') {
        return this.parseForStatement();
      }
      throw new InterpreterError(
        `Syntax error on line ${token.line}: Unexpected keyword '${token.value}'`,
        token.line
      );
    }

    if (token.type === 'IDENTIFIER') {
      const next = this.peekNext();
      if (next && next.type === 'LPAREN') {
        return this.parseCommandStatement();
      }
      if (next && next.type === 'ASSIGN') {
        return this.parseAssignmentStatement();
      }
      throw new InterpreterError(
        `Syntax error on line ${token.line}: Expected '()' after '${token.value}'`,
        token.line
      );
    }

    throw new InterpreterError(
      `Syntax error on line ${token.line}`,
      token.line
    );
  }

  private parseIfStatement(): StatementNode {
    const ifToken = this.consume('KEYWORD', 'if');
    const condition = this.parseExpression();
    this.consumeColon(ifToken.line);
    const consequent = this.parseBlock(ifToken.line);

    let alternate: StatementNode[] | null = null;
    this.skipNewlines();

    if (this.checkKeyword('elif')) {
      const elifStmt = this.parseElifAsIfStatement();
      alternate = [elifStmt];
    } else if (this.checkKeyword('else')) {
      const elseToken = this.advance();
      this.consumeColon(elseToken.line);
      alternate = this.parseBlock(elseToken.line);
    }

    return {
      kind: 'IfStatement',
      condition,
      consequent,
      alternate,
      line: ifToken.line,
    };
  }

  private parseElifAsIfStatement(): StatementNode {
    const elifToken = this.consume('KEYWORD', 'elif');
    const condition = this.parseExpression();
    this.consumeColon(elifToken.line);
    const consequent = this.parseBlock(elifToken.line);

    let alternate: StatementNode[] | null = null;
    this.skipNewlines();

    if (this.checkKeyword('elif')) {
      alternate = [this.parseElifAsIfStatement()];
    } else if (this.checkKeyword('else')) {
      const elseToken = this.advance();
      this.consumeColon(elseToken.line);
      alternate = this.parseBlock(elseToken.line);
    }

    return {
      kind: 'IfStatement',
      condition,
      consequent,
      alternate,
      line: elifToken.line,
    };
  }

  private parseWhileStatement(): StatementNode {
    const whileToken = this.consume('KEYWORD', 'while');
    const condition = this.parseExpression();
    this.consumeColon(whileToken.line);
    const body = this.parseBlock(whileToken.line);

    return {
      kind: 'WhileStatement',
      condition,
      body,
      line: whileToken.line,
    };
  }

  private parseForStatement(): StatementNode {
    const forToken = this.consume('KEYWORD', 'for');
    if (!this.check('IDENTIFIER')) {
      throw new InterpreterError(
        `Syntax error on line ${forToken.line}: Expected loop variable after 'for'`,
        forToken.line
      );
    }
    const iteratorToken = this.advance();
    this.consume('KEYWORD', 'in');
    this.consume('KEYWORD', 'range');
    this.consume('LPAREN');

    const args: ExpressionNode[] = [];
    if (!this.check('RPAREN')) {
      args.push(this.parseExpression());
      while (this.check('COMMA')) {
        this.advance();
        args.push(this.parseExpression());
      }
    }

    this.consume('RPAREN');
    this.consumeColon(forToken.line);
    const body = this.parseBlock(forToken.line);

    return {
      kind: 'ForRangeStatement',
      iterator: iteratorToken.value,
      args,
      body,
      line: forToken.line,
    };
  }

  private parseCommandStatement(): StatementNode {
    const identToken = this.consume('IDENTIFIER');
    this.consume('LPAREN');

    const args: ExpressionNode[] = [];
    if (!this.check('RPAREN')) {
      args.push(this.parseExpression());
      while (this.check('COMMA')) {
        this.advance(); // consume ','
        args.push(this.parseExpression());
      }
    }

    this.consume('RPAREN');
    this.consumeEndOfStatement(identToken.line);

    return {
      kind: 'CommandStatement',
      name: identToken.value,
      args,
      line: identToken.line,
    };
  }

  private parseAssignmentStatement(): StatementNode {
    const identToken = this.consume('IDENTIFIER');
    this.consume('ASSIGN');
    const value = this.parseExpression();
    this.consumeEndOfStatement(identToken.line);

    return {
      kind: 'AssignmentStatement',
      name: identToken.value,
      value,
      line: identToken.line,
    };
  }

  private parseBlock(headerLine: number): StatementNode[] {
    this.consumeEndOfStatement(headerLine);
    this.skipNewlines();

    if (!this.check('INDENT')) {
      const line = this.peek().line;
      throw new InterpreterError(
        `Syntax error on line ${line}: Expected indented block`,
        line
      );
    }
    this.advance(); // consume INDENT

    const statements: StatementNode[] = [];
    this.skipNewlines();

    while (!this.isAtEnd() && !this.check('DEDENT')) {
      statements.push(this.parseStatement());
      this.skipNewlines();
    }

    if (statements.length === 0) {
      throw new InterpreterError(
        `Syntax error on line ${headerLine}: Empty block is not allowed`,
        headerLine
      );
    }

    if (this.check('DEDENT')) {
      this.advance();
    }

    return statements;
  }

  // Expression precedence: or -> and -> not -> comparison -> additive -> multiplicative -> unary -> primary
  private parseExpression(): ExpressionNode {
    return this.parseOr();
  }

  private parseOr(): ExpressionNode {
    let left = this.parseAnd();
    while (this.checkOperator('or')) {
      const op = this.advance();
      const right = this.parseAnd();
      left = {
        kind: 'BinaryExpression',
        operator: op.value as BinaryOperator,
        left,
        right,
        line: op.line,
      };
    }
    return left;
  }

  private parseAnd(): ExpressionNode {
    let left = this.parseNot();
    while (this.checkOperator('and')) {
      const op = this.advance();
      const right = this.parseNot();
      left = {
        kind: 'BinaryExpression',
        operator: op.value as BinaryOperator,
        left,
        right,
        line: op.line,
      };
    }
    return left;
  }

  private parseNot(): ExpressionNode {
    if (this.checkOperator('not')) {
      const op = this.advance();
      return {
        kind: 'UnaryExpression',
        operator: 'not',
        argument: this.parseNot(),
        line: op.line,
      };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode {
    let left = this.parseAdditive();
    while (
      this.checkOperator('>') ||
      this.checkOperator('<') ||
      this.checkOperator('>=') ||
      this.checkOperator('<=') ||
      this.checkOperator('==') ||
      this.checkOperator('!=')
    ) {
      const op = this.advance();
      const right = this.parseAdditive();
      left = {
        kind: 'BinaryExpression',
        operator: op.value as BinaryOperator,
        left,
        right,
        line: op.line,
      };
    }
    return left;
  }

  private parseAdditive(): ExpressionNode {
    let left = this.parseMultiplicative();
    while (this.checkOperator('+') || this.checkOperator('-')) {
      const op = this.advance();
      const right = this.parseMultiplicative();
      left = {
        kind: 'BinaryExpression',
        operator: op.value as BinaryOperator,
        left,
        right,
        line: op.line,
      };
    }
    return left;
  }

  private parseMultiplicative(): ExpressionNode {
    let left = this.parseUnary();
    while (this.checkOperator('*') || this.checkOperator('/')) {
      const op = this.advance();
      const right = this.parseUnary();
      left = {
        kind: 'BinaryExpression',
        operator: op.value as BinaryOperator,
        left,
        right,
        line: op.line,
      };
    }
    return left;
  }

  private parseUnary(): ExpressionNode {
    if (this.checkOperator('-')) {
      const op = this.advance();
      return {
        kind: 'UnaryExpression',
        operator: '-',
        argument: this.parseUnary(),
        line: op.line,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.advance();
      return {
        kind: 'NumberLiteral',
        value: Number(token.value),
        line: token.line,
      };
    }

    if (token.type === 'BOOLEAN') {
      this.advance();
      return {
        kind: 'BooleanLiteral',
        value: token.value === 'True',
        line: token.line,
      };
    }

    if (token.type === 'IDENTIFIER') {
      this.advance();
      // Reject function calls inside expressions with a clear message
      if (this.check('LPAREN')) {
        throw new InterpreterError(
          `Syntax error on line ${token.line}: Unexpected call '${token.value}()' inside expression`,
          token.line
        );
      }
      return {
        kind: 'Variable',
        name: token.value,
        line: token.line,
      };
    }

    if (token.type === 'LPAREN') {
      this.advance();
      const expr = this.parseExpression();
      this.consume('RPAREN');
      return expr;
    }

    throw new InterpreterError(
      `Syntax error on line ${token.line}`,
      token.line
    );
  }

  private consumeColon(line: number): void {
    if (!this.check('COLON')) {
      throw new InterpreterError(
        `Syntax error on line ${line}: Expected ':'`,
        line
      );
    }
    this.advance();
  }

  private consumeEndOfStatement(line: number): void {
    if (this.check('NEWLINE')) {
      this.advance();
      return;
    }
    if (this.check('EOF') || this.check('DEDENT')) {
      return;
    }
    const unexpected = this.peek();
    throw new InterpreterError(
      `Syntax error on line ${unexpected.line || line}`,
      unexpected.line || line
    );
  }

  private skipNewlines(): void {
    while (this.check('NEWLINE')) {
      this.advance();
    }
  }

  private consume(type: TokenType, expectedValue?: string): Token {
    const token = this.peek();
    if (
      token.type !== type ||
      (expectedValue !== undefined && token.value !== expectedValue)
    ) {
      throw new InterpreterError(
        `Syntax error on line ${token.line}`,
        token.line
      );
    }
    return this.advance();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkKeyword(value: string): boolean {
    const tok = this.peek();
    return tok.type === 'KEYWORD' && tok.value === value;
  }

  private checkOperator(value: string): boolean {
    const tok = this.peek();
    return tok.type === 'OPERATOR' && tok.value === value;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private peekNext(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.tokens[this.pos - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }
}

export function parse(tokens: Token[]): ProgramNode {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

