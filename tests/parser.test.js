import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lex, toRPN, evaluateRPN, evaluateExpression, ExpressionError } from '../js/expressionParser.js';

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
