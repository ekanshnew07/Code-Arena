import { InterpreterError, Token } from './ast';

const KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'while',
  'for',
  'in',
  'range',
]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const rawLines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const indentStack: number[] = [0];

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const lineNum = lineIdx + 1;
    const rawLine = rawLines[lineIdx];

    // Strip comment if any
    const commentIndex = rawLine.indexOf('#');
    const lineWithoutComment =
      commentIndex !== -1 ? rawLine.slice(0, commentIndex) : rawLine;

    // Skip empty or whitespace-only lines
    if (lineWithoutComment.trim().length === 0) {
      continue;
    }

    // Measure leading indentation (expand tabs to 4 spaces)
    let indent = 0;
    let col = 0;
    while (col < lineWithoutComment.length) {
      const ch = lineWithoutComment[col];
      if (ch === ' ') {
        indent += 1;
        col++;
      } else if (ch === '\t') {
        indent += 4;
        col++;
      } else {
        break;
      }
    }

    const currentIndent = indentStack[indentStack.length - 1];
    if (indent > currentIndent) {
      indentStack.push(indent);
      tokens.push({
        type: 'INDENT',
        value: '',
        line: lineNum,
        column: 1,
      });
    } else if (indent < currentIndent) {
      while (
        indentStack.length > 1 &&
        indentStack[indentStack.length - 1] > indent
      ) {
        indentStack.pop();
        tokens.push({
          type: 'DEDENT',
          value: '',
          line: lineNum,
          column: 1,
        });
      }
      if (indentStack[indentStack.length - 1] !== indent) {
        throw new InterpreterError(
          `Syntax error on line ${lineNum}: Inconsistent indentation`,
          lineNum
        );
      }
    }

    // Tokenize the rest of the line
    while (col < lineWithoutComment.length) {
      const ch = lineWithoutComment[col];

      if (ch === ' ' || ch === '\t') {
        col++;
        continue;
      }

      const tokenCol = col + 1;

      // Two-character operators
      const twoChar = lineWithoutComment.slice(col, col + 2);
      if (
        twoChar === '>=' ||
        twoChar === '<=' ||
        twoChar === '==' ||
        twoChar === '!='
      ) {
        tokens.push({
          type: 'OPERATOR',
          value: twoChar,
          line: lineNum,
          column: tokenCol,
        });
        col += 2;
        continue;
      }

      // Single-character operators
      if (
        ch === '>' ||
        ch === '<' ||
        ch === '+' ||
        ch === '-' ||
        ch === '*' ||
        ch === '/'
      ) {
        tokens.push({
          type: 'OPERATOR',
          value: ch,
          line: lineNum,
          column: tokenCol,
        });
        col++;
        continue;
      }

      if (ch === '=') {
        tokens.push({
          type: 'ASSIGN',
          value: '=',
          line: lineNum,
          column: tokenCol,
        });
        col++;
        continue;
      }

      if (ch === '(') {
        tokens.push({
          type: 'LPAREN',
          value: '(',
          line: lineNum,
          column: tokenCol,
        });
        col++;
        continue;
      }

      if (ch === ')') {
        tokens.push({
          type: 'RPAREN',
          value: ')',
          line: lineNum,
          column: tokenCol,
        });
        col++;
        continue;
      }

      if (ch === ':') {
        tokens.push({
          type: 'COLON',
          value: ':',
          line: lineNum,
          column: tokenCol,
        });
        col++;
        continue;
      }

      if (ch === ',') {
        tokens.push({
          type: 'COMMA',
          value: ',',
          line: lineNum,
          column: tokenCol,
        });
        col++;
        continue;
      }

      // Number literals
      if (ch >= '0' && ch <= '9') {
        let numStr = '';
        let hasDot = false;
        while (col < lineWithoutComment.length) {
          const c = lineWithoutComment[col];
          if (c >= '0' && c <= '9') {
            numStr += c;
            col++;
          } else if (c === '.' && !hasDot) {
            hasDot = true;
            numStr += c;
            col++;
          } else {
            break;
          }
        }
        tokens.push({
          type: 'NUMBER',
          value: numStr,
          line: lineNum,
          column: tokenCol,
        });
        continue;
      }

      // Identifiers, Keywords, Booleans
      if (
        (ch >= 'a' && ch <= 'z') ||
        (ch >= 'A' && ch <= 'Z') ||
        ch === '_'
      ) {
        let ident = '';
        while (col < lineWithoutComment.length) {
          const c = lineWithoutComment[col];
          if (
            (c >= 'a' && c <= 'z') ||
            (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') ||
            c === '_'
          ) {
            ident += c;
            col++;
          } else {
            break;
          }
        }

        if (ident === 'True' || ident === 'False') {
          tokens.push({
            type: 'BOOLEAN',
            value: ident,
            line: lineNum,
            column: tokenCol,
          });
        } else if (ident === 'and' || ident === 'or' || ident === 'not') {
          tokens.push({
            type: 'OPERATOR',
            value: ident,
            line: lineNum,
            column: tokenCol,
          });
        } else if (KEYWORDS.has(ident)) {
          tokens.push({
            type: 'KEYWORD',
            value: ident,
            line: lineNum,
            column: tokenCol,
          });
        } else {
          tokens.push({
            type: 'IDENTIFIER',
            value: ident,
            line: lineNum,
            column: tokenCol,
          });
        }
        continue;
      }

      throw new InterpreterError(
        `Syntax error on line ${lineNum}: Unexpected character '${ch}'`,
        lineNum
      );
    }

    tokens.push({
      type: 'NEWLINE',
      value: '\\n',
      line: lineNum,
      column: lineWithoutComment.length + 1,
    });
  }

  // Close remaining open indentation levels
  const lastLine = rawLines.length || 1;
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({
      type: 'DEDENT',
      value: '',
      line: lastLine,
      column: 1,
    });
  }

  tokens.push({
    type: 'EOF',
    value: '',
    line: lastLine,
    column: 1,
  });

  return tokens;
}

