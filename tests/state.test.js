import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalculatorState, DisplayState } from '../js/calculatorState.js';

test('CalculatorState digit input and evaluation flow', () => {
  const state = new CalculatorState();
  state.inputDigit('1');
  state.inputDigit('2');
  state.inputOperator('+');
  state.inputDigit('3');

  assert.equal(state.rawExpression, '12+3');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '15');
  assert.equal(state.displayState, DisplayState.RESULT);
});

test('Auto-closing unclosed parentheses on evaluation', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputDigit('5');
  state.inputOperator('+');
  state.inputDigit('5');
  // Paren not closed explicitly

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '10');
});

test('Trailing operator auto-trimming on evaluation', () => {
  const state = new CalculatorState();
  state.inputDigit('6');
  state.inputDigit('1');
  state.inputOperator('+');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '61');
});

test('Pre-decimal digit limit check', () => {
  const state = new CalculatorState();
  for (let i = 0; i < 15; i++) state.inputDigit('1');
  assert.equal(state.tokens.length, 15);

  state.inputDigit('9'); // Should be blocked
  assert.equal(state.tokens.length, 15);

  state.inputDecimal();
  state.inputDigit('9'); // Post-decimal digit allowed
  assert.equal(state.tokens.length, 17);
});

test('Reciprocal zero shows Division by zero error', () => {
  const state = new CalculatorState();
  state.inputDigit('0');
  state.inputReciprocal();
  const outcome = state.evaluate();

  assert.equal(outcome.success, false);
  assert.equal(outcome.error, 'Division by zero');
});
