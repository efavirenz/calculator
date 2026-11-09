/**
 * expressionParser.js
 *
 * A dependency-free arithmetic expression parser and evaluator.
 * Supports: + - × ÷ ^ (right-associative), parentheses, decimals,
 * and unary negation. Expression text is never executed as code.
 *
 * Pipeline: raw string -> lex() -> tokens -> toRPN() (Shunting Yard)
 * -> evaluateRPN() -> number
 *
 * This module has NO knowledge of the DOM, UI state, or button
 * layout. It only knows how to turn a math string into a number.
 */

/** Custom error type so callers can distinguish parse/eval failures. */
export class ExpressionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExpressionError';
  }
}

const OPERATORS = new Set(['+', '-', '×', '÷', '^']);

// Precedence table. Higher binds tighter.
// ^ (4, right-assoc) > unary minus (3) > × ÷ (2) > binary + - (1)
const PRECEDENCE = {
  '+': 1,
  '-': 1,
  '×': 2,
  '÷': 2,
  'u-': 3,
  '^': 4,
};

// Only incoming operators are consulted here; 'u-' is produced directly by
// the unary-context branch below and never arrives via comparePrecedence().
const RIGHT_ASSOCIATIVE = new Set(['^']);

/**
 * Display/numeric policy: number of significant digits retained when a
 * result is formatted. Must stay >= the 15-digit input acceptance limit in
 * calculatorState.js so that pressing "=" never corrupts an accepted value.
 */
export const SIGNIFICANT_DIGITS = 15;

/**
 * Converts a raw expression string into a flat array of lexical tokens.
 * Token shapes:
 *   { type: 'number', value: '12.5' }
 *   { type: 'operator', value: '+' | '-' | '×' | '÷' | '^' }
 *   { type: 'lparen' }
 *   { type: 'rparen' }
 * @param {string} input
 * @returns {Array<object>}
 */
export function lex(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ' ') {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    if (OPERATORS.has(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i += 1;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      let seenDecimal = false;
      let numStr = '';
      while (j < input.length && ((input[j] >= '0' && input[j] <= '9') || input[j] === '.')) {
        if (input[j] === '.') {
          if (seenDecimal) {
            throw new ExpressionError('Malformed decimal number');
          }
          seenDecimal = true;
        }
        numStr += input[j];
        j += 1;
      }
      if (!/\d/.test(numStr)) {
        throw new ExpressionError('Malformed decimal number');
      }
      tokens.push({ type: 'number', value: numStr });
      i = j;
      continue;
    }

    throw new ExpressionError(`Unexpected character: ${ch}`);
  }

  return tokens;
}

/**
 * Rewrites +/- tokens as unary where appropriate (start of expression,
 * after another operator, or after an open paren) and converts the
 * token stream into Reverse Polish Notation using the Shunting Yard
 * algorithm.
 * @param {Array<object>} tokens
 * @returns {Array<object>}
 */
export function toRPN(tokens) {
  const output = [];
  const opStack = [];
  let prevToken = null;

  const isUnaryContext = () =>
    prevToken === null ||
    prevToken.type === 'operator' ||
    prevToken.type === 'lparen';

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
    } else if (token.type === 'operator') {
      let opValue = token.value;

      if ((opValue === '-' || opValue === '+') && isUnaryContext()) {
        if (opValue === '-') {
          // Unary minus: push as a distinct operator without popping pending binary operators.
          opStack.push({ type: 'operator', value: 'u-' });
        }
        // Unary plus is a no-op: skip pushing anything.
      } else {
        while (
          opStack.length > 0 &&
          opStack[opStack.length - 1].type === 'operator' &&
          comparePrecedence(opStack[opStack.length - 1].value, opValue)
        ) {
          output.push(opStack.pop());
        }
        opStack.push({ type: 'operator', value: opValue });
      }
    } else if (token.type === 'lparen') {
      opStack.push(token);
    } else if (token.type === 'rparen') {
      let foundMatch = false;
      while (opStack.length > 0) {
        const top = opStack.pop();
        if (top.type === 'lparen') {
          foundMatch = true;
          break;
        }
        output.push(top);
      }
      if (!foundMatch) {
        throw new ExpressionError('Unmatched closing parenthesis');
      }
    }

    prevToken = token;
  }

  while (opStack.length > 0) {
    const top = opStack.pop();
    if (top.type === 'lparen') {
      throw new ExpressionError('Unmatched opening parenthesis');
    }
    output.push(top);
  }

  return output;
}

/**
 * Determines whether the operator currently on top of the stack should
 * be popped before pushing `incoming`, per standard Shunting Yard rules.
 * @param {string} stackTop
 * @param {string} incoming
 * @returns {boolean}
 */
function comparePrecedence(stackTop, incoming) {
  const stackPrec = PRECEDENCE[stackTop];
  const incomingPrec = PRECEDENCE[incoming];
  if (stackPrec > incomingPrec) return true;
  if (stackPrec === incomingPrec && !RIGHT_ASSOCIATIVE.has(incoming)) return true;
  return false;
}

/**
 * Evaluates an RPN token stream into a single numeric result.
 * @param {Array<object>} rpn
 * @returns {number}
 */
export function evaluateRPN(rpn) {
  const stack = [];

  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(parseFloat(token.value));
      continue;
    }

    if (token.value === 'u-') {
      if (stack.length < 1) throw new ExpressionError('Invalid expression');
      const a = stack.pop();
      stack.push(-a);
      continue;
    }

    if (stack.length < 2) throw new ExpressionError('Invalid expression');
    const b = stack.pop();
    const a = stack.pop();

    switch (token.value) {
      case '+':
        stack.push(a + b);
        break;
      case '-':
        stack.push(a - b);
        break;
      case '×':
        stack.push(a * b);
        break;
      case '÷':
        if (b === 0) throw new ExpressionError('Division by zero');
        stack.push(a / b);
        break;
      case '^':
        if (a === 0 && b < 0) throw new ExpressionError('Division by zero');
        stack.push(Math.pow(a, b));
        break;
      default:
        throw new ExpressionError(`Unknown operator: ${token.value}`);
    }
  }

  if (stack.length !== 1) {
    throw new ExpressionError('Invalid expression');
  }

  return stack[0];
}

/**
 * Validates that an expression is syntactically well-formed without
 * computing a value. Unlike evaluateExpression(), this accepts expressions
 * that are structurally valid but would fail at evaluation time (division by
 * zero, non-finite overflow, etc.). Used by the paste pipeline so syntax
 * validation is not conflated with a successful calculation.
 * @param {string} expressionString
 * @returns {boolean} always true; throws ExpressionError when invalid
 */
export function validateSyntax(expressionString) {
  if (!expressionString || expressionString.trim() === '') {
    throw new ExpressionError('Empty expression');
  }
  const tokens = lex(expressionString);
  if (tokens.length === 0) {
    throw new ExpressionError('Empty expression');
  }
  const rpn = toRPN(tokens);

  // Structural arity check: simulate the RPN stack depth without evaluating.
  let depth = 0;
  for (const token of rpn) {
    if (token.type === 'number') {
      depth += 1;
    } else if (token.type === 'operator') {
      const arity = token.value === 'u-' ? 1 : 2;
      if (depth < arity) throw new ExpressionError('Invalid expression');
      depth -= arity - 1;
    }
  }
  if (depth !== 1) throw new ExpressionError('Invalid expression');
  return true;
}

/**
 * Cleans up floating point noise and formats a number for display.
 *
 * Precision policy: values are rounded to SIGNIFICANT_DIGITS (15)
 * significant digits, which matches the 15-digit input acceptance policy in
 * calculatorState.js. Keeping these limits aligned guarantees that an
 * accepted integer is displayed and re-chained without corruption.
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
  if (!Number.isFinite(value)) {
    throw new ExpressionError('Result is not a finite number');
  }

  // Round to the display precision to eliminate float noise, then
  // strip trailing zeros / trailing decimal point.
  let rounded = parseFloat(value.toPrecision(SIGNIFICANT_DIGITS));

  // Guard against -0.
  if (Object.is(rounded, -0)) rounded = 0;

  // Use exponential notation for extremely large/small magnitudes,
  // matching typical calculator behavior.
  const abs = Math.abs(rounded);
  if (rounded !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    return rounded.toExponential(SIGNIFICANT_DIGITS - 1).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))e/, '$1e');
  }

  return rounded.toString();
}

/**
 * Full pipeline: raw expression string -> formatted result string.
 * Throws ExpressionError on any invalid input.
 * @param {string} expressionString
 * @returns {string}
 */
export function evaluateExpression(expressionString) {
  if (!expressionString || expressionString.trim() === '') {
    throw new ExpressionError('Empty expression');
  }
  const tokens = lex(expressionString);
  if (tokens.length === 0) {
    throw new ExpressionError('Empty expression');
  }
  const rpn = toRPN(tokens);
  const result = evaluateRPN(rpn);
  return formatNumber(result);
}
