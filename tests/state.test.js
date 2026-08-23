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

test('Pre-decimal digit limit check (F-002 forward scanning)', () => {
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

test('Backspace retains exponentMode after popping digit following power operator (F-008)', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputPower(); // inserts hidden '^', exponentMode = true
  state.inputDigit('2'); // isExponent = true
  assert.equal(state.exponentMode, true);

  state.backspace(); // pops '2'
  assert.equal(state.exponentMode, true); // Should stay in exponentMode because '^' is trailing

  state.inputDigit('3');
  assert.equal(state.tokens[state.tokens.length - 1].isExponent, true);
  assert.equal(state.rawExpression, '5^3');
});

test('Close parenthesis disallowed directly after operator (F-006)', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputDigit('5');
  state.inputOperator('+');
  state.inputCloseParen(); // Should be no-op because last token is operator '+'

  assert.equal(state.rawExpression, '(5+');
});

test('_tokensFromString converts scientific notation properly (F-001)', () => {
  const state = new CalculatorState();
  state.resultString = '1e+15';
  state.displayState = DisplayState.RESULT;

  state.inputOperator('+'); // re-tokenizes resultString
  assert.equal(state.rawExpression, '1000000000000000+');
});

test('toggleSign toggles numeric operand sign correctly', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.toggleSign();
  assert.equal(state.rawExpression, '-5');

  state.toggleSign();
  assert.equal(state.rawExpression, '5');
});

test('toggleSign on parenthesized group toggles cleanly without stacking (N-002)', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputDigit('5');
  state.inputOperator('+');
  state.inputDigit('3');
  state.inputCloseParen();
  assert.equal(state.rawExpression, '(5+3)');

  state.toggleSign();
  assert.equal(state.rawExpression, '-(5+3)');

  state.toggleSign();
  assert.equal(state.rawExpression, '(5+3)');
});

test('toggleSign preserves isExponent on exponent operands (N-003)', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputPower();
  state.inputDigit('3');
  state.toggleSign();

  const minusToken = state.tokens[state.tokens.length - 2];
  assert.equal(minusToken.char, '-');
  assert.equal(minusToken.isExponent, true);
  assert.equal(state.rawExpression, '5^-3');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '0.008');
});

test('inputOpenParen performs implicit multiplication (F-004)', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputOpenParen();
  state.inputDigit('3');
  state.inputCloseParen();
  assert.equal(state.rawExpression, '5×(3)');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '15');
});

test('inputCloseParen blocks empty parentheses () (F-003)', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputCloseParen(); // Should be blocked
  assert.equal(state.rawExpression, '(');
});

test('backspace from error state clears error (T-001)', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputOperator('÷');
  state.inputDigit('0');
  state.evaluate();
  assert.equal(state.isError, true);

  state.backspace();
  assert.equal(state.isError, false);
});

test('chained reciprocal evaluates correctly (T-001)', () => {
  const state = new CalculatorState();
  state.inputDigit('4');
  state.inputReciprocal();
  state.inputReciprocal();
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '4');
});

test('_tokensFromString converts fractional scientific notation properly (T-003)', () => {
  const state = new CalculatorState();
  state.resultString = '1.5e-10';
  state.displayState = DisplayState.RESULT;
  state.inputOperator('+');
  assert.equal(state.rawExpression, '0.00000000015+');
});

test('loadFromHistory restores tokens and state correctly (T-001)', () => {
  const state = new CalculatorState();
  const tokens = [
    { char: '2', kind: 'digit', isExponent: false, hidden: false },
    { char: '+', kind: 'operator', isExponent: false, hidden: false },
    { char: '2', kind: 'digit', isExponent: false, hidden: false },
  ];
  state.loadFromHistory(tokens, '4');
  assert.equal(state.displayState, DisplayState.RESULT);
  assert.equal(state.resultString, '4');

  state.inputOperator('×');
  state.inputDigit('3');
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '12');
});

test('pasteNumber pastes integer into empty state', () => {
  const state = new CalculatorState();
  const ok = state.pasteNumber('12345');
  assert.equal(ok, true);
  assert.equal(state.rawExpression, '12345');
});

test('pasteNumber pastes decimal and formatted currency into expression', () => {
  const state = new CalculatorState();
  state.inputDigit('1');
  state.inputDigit('0');
  state.inputOperator('+');

  const ok = state.pasteNumber('$1,234.50');
  assert.equal(ok, true);
  assert.equal(state.rawExpression, '10+1234.50');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '1244.5');
});

test('pasteNumber pastes negative numbers correctly', () => {
  const state = new CalculatorState();
  const ok = state.pasteNumber('-50.25');
  assert.equal(ok, true);
  assert.equal(state.rawExpression, '-50.25');
});

test('pasteNumber rejects invalid non-numeric strings', () => {
  const state = new CalculatorState();
  state.inputDigit('9');
  assert.equal(state.pasteNumber('hello world'), false);
  assert.equal(state.pasteNumber(''), false);
  assert.equal(state.pasteNumber('12+34'), false);
  assert.equal(state.pasteNumber(null), false);
  assert.equal(state.rawExpression, '9');
});

test('pasteNumber starts fresh when in RESULT display state', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputOperator('+');
  state.inputDigit('5');
  state.evaluate();
  assert.equal(state.displayState, DisplayState.RESULT);

  const ok = state.pasteNumber('99');
  assert.equal(ok, true);
  assert.equal(state.displayState, DisplayState.ENTRY);
  assert.equal(state.rawExpression, '99');
});

