import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lex, toRPN, evaluateRPN, evaluateExpression, ExpressionError, formatNumber, validateSyntax, SIGNIFICANT_DIGITS } from '../js/expressionParser.js';

test('lexing basic mathematical expression', () => {
  const tokens = lex('12 + 3.4 × 5');
  assert.equal(tokens.length, 5);
  assert.equal(tokens[0].value, '12');
  assert.equal(tokens[1].value, '+');
  assert.equal(tokens[2].value, '3.4');
  assert.equal(tokens[3].value, '×');
  assert.equal(tokens[4].value, '5');
});
test('Shunting Yard to RPN with precedence and right-associative power', () => {
  const tokens = lex('2^3^2');
  const rpn = toRPN(tokens);
  const result = evaluateRPN(rpn);
  assert.equal(result, 512); // 2^(3^2) = 2^9 = 512
});
test('Unary minus precedence vs exponentiation', () => {
  const result = evaluateExpression('-2^2');
  assert.equal(result, '-4');
});
test('Division by zero error handling', () => {
  assert.throws(
    () => evaluateExpression('10 ÷ 0'),
    (err) => err instanceof ExpressionError && err.message === 'Division by zero'
  );
});
test('Reciprocal of zero throws Division by zero', () => {
  assert.throws(
    () => evaluateExpression('0^(-1)'),
    (err) => err instanceof ExpressionError && err.message === 'Division by zero'
  );
});
test('Parentheses precedence and auto-evaluation', () => {
  const result = evaluateExpression('(2 + 3) × 4');
  assert.equal(result, '20');
});
test('Bare dot throws Malformed decimal number error (F-005)', () => {
  assert.throws(
    () => evaluateExpression('.'),
    (err) => err instanceof ExpressionError && err.message === 'Malformed decimal number'
  );
});
test('Multiple dots in number throw Malformed decimal number error', () => {
  assert.throws(
    () => evaluateExpression('1.2.3 + 4'),
    (err) => err instanceof ExpressionError && err.message === 'Malformed decimal number'
  );
});
test('Nested parentheses evaluation', () => {
  const result = evaluateExpression('((2 + 3) × 4) + 1');
  assert.equal(result, '21');
});
test('Negative power evaluation without parentheses (N-001)', () => {
  assert.equal(evaluateExpression('2^-3'), '0.125');
  assert.equal(evaluateExpression('2^-2'), '0.25');
  assert.equal(evaluateExpression('10^-3'), '0.001');
});
test('Negative base with parentheses exponentiation', () => {
  assert.equal(evaluateExpression('(-2)^2'), '4');
  assert.equal(evaluateExpression('(-2)^3'), '-8');
});
test('Unary minus following binary operators', () => {
  assert.equal(evaluateExpression('5×-3'), '-15');
  assert.equal(evaluateExpression('10+-4'), '6');
  assert.equal(evaluateExpression('12÷-3'), '-4');
});
test('Unclosed parenthesis direct evaluateExpression call throws ExpressionError (TEST-001)', () => {
  assert.throws(
    () => evaluateExpression('(2+3'),
    (err) => err instanceof ExpressionError && err.message === 'Unmatched opening parenthesis'
  );
});
test('Consecutive invalid operators direct call throws ExpressionError (TEST-001)', () => {
  assert.throws(
    () => evaluateExpression('5+×3'),
    (err) => err instanceof ExpressionError && err.message === 'Invalid expression'
  );
});
test('Large exponent scientific evaluation (TEST-001)', () => {
  const result = evaluateExpression('10^25');
  assert.equal(result, '1e+25');
});
test('Small exponent scientific evaluation (TEST-001)', () => {
  const result = evaluateExpression('10^-22');
  assert.equal(result, '1e-22');
});
test('Scientific notation preserves significant digits and threshold formatting', () => {
  assert.equal(formatNumber(1.23456789012e20), '1.23456789012e+20');
  assert.equal(formatNumber(-1.23456789012e-20), '-1.23456789012e-20');
  assert.equal(formatNumber(1e15), '1e+15');
  assert.equal(formatNumber(1e-9), '1e-9');
});

test('formatNumber preserves accepted 13-15 digit inputs (AUD-001)', () => {
  assert.equal(SIGNIFICANT_DIGITS, 15);
  assert.equal(formatNumber(999999999999999), '999999999999999');
  assert.equal(formatNumber(123456789012345), '123456789012345');
  assert.equal(evaluateExpression('1234567890123'), '1234567890123');
  assert.equal(evaluateExpression('1234567890123+1'), '1234567890124');
  assert.equal(evaluateExpression('1234567890120+1'), '1234567890121');
  assert.equal(evaluateExpression('99999999999999.9'), '99999999999999.9');
});

test('formatNumber keeps floating-point noise cleanup at 15 digits', () => {
  assert.equal(evaluateExpression('0.1+0.2'), '0.3');
  assert.equal(evaluateExpression('0.1+0.7'), '0.8');
  assert.equal(evaluateExpression('1.005×100'), '100.5');
});

test('formatNumber exponential thresholds remain consistent with 15 digits', () => {
  assert.equal(formatNumber(1e14), '100000000000000');
  assert.equal(formatNumber(1e15), '1e+15');
  assert.equal(formatNumber(1e-9), '1e-9');
  assert.equal(formatNumber(-1.234567890123456e-20), '-1.23456789012346e-20');
});

test('validateSyntax accepts grammatically valid expressions that fail evaluation (AUD-021)', () => {
  for (const expression of ['1÷0', '10^400', '(-2)^0.5', '2^-3']) {
    assert.equal(validateSyntax(expression), true, expression);
  }
});

test('validateSyntax rejects malformed grammar', () => {
  for (const expression of ['', '   ', '5+', '(5', '5+×3', '1.2.3', '5)']) {
    assert.throws(() => validateSyntax(expression), ExpressionError, expression);
  }
});
