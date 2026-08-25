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
  assert.equal(state.rawExpression, '5^(3)');
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
  assert.equal(state.rawExpression, '5^(-3)');

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

test('pasteExpression rejects invalid strings or strings without digits', () => {
  const state = new CalculatorState();
  state.inputDigit('9');
  assert.equal(state.pasteExpression('hello world'), false);
  assert.equal(state.pasteExpression(''), false);
  assert.equal(state.pasteExpression('+++'), false);
  assert.equal(state.pasteExpression(null), false);
  assert.equal(state.rawExpression, '9');
});

test('pasteExpression pastes full equations with operators and parens', () => {
  const state = new CalculatorState();
  const ok = state.pasteExpression('(10 + 5) * 3 / 2');
  assert.equal(ok, true);
  assert.equal(state.rawExpression, '(10+5)×3÷2');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '22.5');
});

test('pasteExpression appends equation to existing expression', () => {
  const state = new CalculatorState();
  state.inputDigit('5');
  state.inputOperator('+');

  const ok = state.pasteExpression('12 * 3');
  assert.equal(ok, true);
  assert.equal(state.rawExpression, '5+12×3');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '41');
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

test('exponent mode persists across operators and parentheses', () => {
  const state = new CalculatorState();
  state.inputDigit('3');
  state.inputPower();
  state.inputOpenParen();
  state.inputDigit('1');
  state.inputOperator('÷');
  state.inputDigit('3');
  state.inputCloseParen();

  assert.equal(state.rawExpression, '3^(1÷3)');

  // Verify tokens have isExponent: true for all exponent parts
  const tokens = state.tokens;
  // token 0: '3' (base)
  assert.equal(tokens[0].char, '3');
  assert.equal(tokens[0].isExponent, false);
  // token 1: '^' (hidden operator)
  assert.equal(tokens[1].char, '^');
  assert.equal(tokens[1].hidden, true);
  // token 2: '(' (lparen in exponent)
  assert.equal(tokens[2].char, '(');
  assert.equal(tokens[2].isExponent, true);
  // token 3: '1'
  assert.equal(tokens[3].char, '1');
  assert.equal(tokens[3].isExponent, true);
  // token 4: '÷'
  assert.equal(tokens[4].char, '÷');
  assert.equal(tokens[4].isExponent, true);
  // token 5: '3'
  assert.equal(tokens[5].char, '3');
  assert.equal(tokens[5].isExponent, true);
  // token 6: ')'
  assert.equal(tokens[6].char, ')');
  assert.equal(tokens[6].isExponent, true);

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '1.44224957031');
});

test('exponent mode persists with binary plus/minus and backspace recomputation', () => {
  const state = new CalculatorState();
  state.inputDigit('2');
  state.inputPower();
  state.inputDigit('3');
  state.inputOperator('+');
  state.inputDigit('1');

  assert.equal(state.rawExpression, '2^(3+1)');
  const plusToken = state.tokens[state.tokens.length - 2];
  assert.equal(plusToken.char, '+');
  assert.equal(plusToken.isExponent, true);

  // Backspace digit 1 -> trailing token is now '+' with isExponent: true
  state.backspace();
  assert.equal(state.exponentMode, true);

  // Backspace operator '+' -> trailing token is now '3' with isExponent: true
  state.backspace();
  assert.equal(state.exponentMode, true);

  // Backspace digit '3' -> trailing token is now '^'
  state.backspace();
  assert.equal(state.exponentMode, true);

  // Backspace '^' -> exponent mode should now be false
  state.backspace();
  assert.equal(state.exponentMode, false);
  assert.equal(state.rawExpression, '2');
});

test('pressing xʸ again exits exponent mode back to normal', () => {
  const state = new CalculatorState();
  state.inputDigit('2');
  state.inputPower();
  assert.equal(state.exponentMode, true);

  state.inputDigit('3');
  assert.equal(state.exponentMode, true);
  assert.equal(state.tokens[state.tokens.length - 1].isExponent, true);

  // Press xʸ again to exit exponent mode
  state.inputPower();
  assert.equal(state.exponentMode, false);

  // Next digit should be normal-sized
  state.inputOperator('+');
  state.inputDigit('1');
  assert.equal(state.tokens[state.tokens.length - 1].isExponent, false);

  assert.equal(state.rawExpression, '2^(3)+1');
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '9');
});

test('isPowerEnabled correctly enables only for numbers and exponent toggle-off', () => {
  const state = new CalculatorState();

  // Initially empty -> disabled
  assert.equal(state.isPowerEnabled, false);

  // Type digit -> enabled
  state.inputDigit('5');
  assert.equal(state.isPowerEnabled, true);

  // Decimal -> enabled
  state.inputDecimal();
  assert.equal(state.isPowerEnabled, true);

  // Operator '+' -> disabled
  state.inputOperator('+');
  assert.equal(state.isPowerEnabled, false);

  // Open paren -> disabled
  state.inputOpenParen();
  assert.equal(state.isPowerEnabled, false);

  // Digit inside paren -> enabled
  state.inputDigit('3');
  assert.equal(state.isPowerEnabled, true);

  // Close paren -> enabled
  state.inputCloseParen();
  assert.equal(state.isPowerEnabled, true);

  // Enter exponent mode -> enabled (allows toggle off)
  state.inputPower();
  assert.equal(state.isPowerEnabled, true);
  assert.equal(state.exponentMode, true);

  // Operator inside exponent -> enabled while in exponentMode
  state.inputOperator('+');
  assert.equal(state.isPowerEnabled, true);

  // Toggle off exponent mode -> now ends in operator '+', so disabled
  state.inputPower();
  assert.equal(state.exponentMode, false);
  assert.equal(state.isPowerEnabled, false);

  // Add digit and evaluate -> in RESULT state with valid result, isPowerEnabled is true
  state.inputDigit('2');
  state.evaluate();
  assert.equal(state.displayState, DisplayState.RESULT);
  assert.equal(state.isPowerEnabled, true);
});

test('isReciprocalEnabled enables only for numbers, decimals, close paren, and valid result state', () => {
  const state = new CalculatorState();

  // Initially empty -> disabled
  assert.equal(state.isReciprocalEnabled, false);

  // Type digit -> enabled
  state.inputDigit('5');
  assert.equal(state.isReciprocalEnabled, true);

  // Decimal -> enabled
  state.inputDecimal();
  assert.equal(state.isReciprocalEnabled, true);

  // Operator '+' -> disabled
  state.inputOperator('+');
  assert.equal(state.isReciprocalEnabled, false);

  // Open paren -> disabled
  state.inputOpenParen();
  assert.equal(state.isReciprocalEnabled, false);

  // Digit inside paren -> enabled
  state.inputDigit('3');
  assert.equal(state.isReciprocalEnabled, true);

  // Close paren -> enabled
  state.inputCloseParen();
  assert.equal(state.isReciprocalEnabled, true);

  // Power operator (hidden '^') -> disabled
  state.inputPower();
  assert.equal(state.isReciprocalEnabled, false);

  // Digit in exponent -> enabled
  state.inputDigit('2');
  assert.equal(state.isReciprocalEnabled, true);

  // Evaluate to result -> in RESULT state with valid result, isReciprocalEnabled is true
  state.evaluate();
  assert.equal(state.displayState, DisplayState.RESULT);
  assert.equal(state.isReciprocalEnabled, true);

  // Division by zero error -> disabled
  state.clearAll();
  state.inputDigit('5');
  state.inputOperator('÷');
  state.inputDigit('0');
  state.evaluate();
  assert.equal(state.isError, true);
  assert.equal(state.isReciprocalEnabled, false);
});

test('1/x button wraps operand as (1÷x) and computes accurately', () => {
  const state = new CalculatorState();

  // 1/x on single digit 5 -> (1÷5) = 0.2
  state.inputDigit('5');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷5)');
  let outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '0.2');

  // 1/x on decimal 0.5 -> (1÷0.5) = 2
  state.clearAll();
  state.inputDigit('0');
  state.inputDecimal();
  state.inputDigit('5');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷0.5)');
  outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '2');

  // 1/x on trailing operand in expression 2+8 -> 2+(1÷8) = 2.125
  state.clearAll();
  state.inputDigit('2');
  state.inputOperator('+');
  state.inputDigit('8');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '2+(1÷8)');
  outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '2.125');

  // 1/x on parenthesized expression (2+3) -> (1÷(2+3)) = 0.2
  state.clearAll();
  state.inputOpenParen();
  state.inputDigit('2');
  state.inputOperator('+');
  state.inputDigit('3');
  state.inputCloseParen();
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷(2+3))');
  outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '0.2');
});

test('exponent calculation evaluates 9^1/3 as 9^(1/3) = 2.08008382305', () => {
  const state = new CalculatorState();
  state.inputDigit('9');
  state.inputPower();
  state.inputDigit('1');
  state.inputOperator('÷');
  state.inputDigit('3');

  assert.equal(state.rawExpression, '9^(1÷3)');
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '2.08008382305');
});

test('exponent calculation evaluates 16^1/4 as 16^(1/4) = 2', () => {
  const state = new CalculatorState();
  state.inputDigit('1');
  state.inputDigit('6');
  state.inputPower();
  state.inputDigit('1');
  state.inputOperator('÷');
  state.inputDigit('4');

  assert.equal(state.rawExpression, '16^(1÷4)');
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '2');
});

test('isSignEnabled enables only for numbers, decimals, close paren, and valid result state', () => {
  const state = new CalculatorState();

  // Initially empty -> disabled
  assert.equal(state.isSignEnabled, false);

  // Type digit -> enabled
  state.inputDigit('5');
  assert.equal(state.isSignEnabled, true);

  // Decimal -> enabled
  state.inputDecimal();
  assert.equal(state.isSignEnabled, true);

  // Operator '+' -> disabled
  state.inputOperator('+');
  assert.equal(state.isSignEnabled, false);

  // Open paren -> disabled
  state.inputOpenParen();
  assert.equal(state.isSignEnabled, false);

  // Digit inside paren -> enabled
  state.inputDigit('3');
  assert.equal(state.isSignEnabled, true);

  // Close paren -> enabled
  state.inputCloseParen();
  assert.equal(state.isSignEnabled, true);

  // Power operator (hidden '^') -> disabled
  state.inputPower();
  assert.equal(state.isSignEnabled, false);

  // Digit in exponent -> enabled
  state.inputDigit('2');
  assert.equal(state.isSignEnabled, true);

  // Evaluate to result -> in RESULT state with valid result, isSignEnabled is true
  state.evaluate();
  assert.equal(state.displayState, DisplayState.RESULT);
  assert.equal(state.isSignEnabled, true);

  // Error state -> disabled
  state.clearAll();
  state.inputDigit('5');
  state.inputOperator('÷');
  state.inputDigit('0');
  state.evaluate();
  assert.equal(state.isError, true);
  assert.equal(state.isSignEnabled, false);
});

test('1/x button unwraps (1÷x) back to x when tapped again (toggle)', () => {
  const state = new CalculatorState();

  // 5 -> 1/x -> (1÷5) -> 1/x -> 5
  state.inputDigit('5');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷5)');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '5');

  // 0.5 -> 1/x -> (1÷0.5) -> 1/x -> 0.5
  state.clearAll();
  state.inputDigit('0');
  state.inputDecimal();
  state.inputDigit('5');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷0.5)');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '0.5');

  // 2+8 -> 1/x -> 2+(1÷8) -> 1/x -> 2+8
  state.clearAll();
  state.inputDigit('2');
  state.inputOperator('+');
  state.inputDigit('8');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '2+(1÷8)');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '2+8');

  // (2+3) -> 1/x -> (1÷(2+3)) -> 1/x -> (2+3)
  state.clearAll();
  state.inputOpenParen();
  state.inputDigit('2');
  state.inputOperator('+');
  state.inputDigit('3');
  state.inputCloseParen();
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷(2+3))');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(2+3)');
});

test('1/x button in exponent mode creates superscript (1÷x) and unwraps accurately', () => {
  const state = new CalculatorState();

  // 9 -> power -> 3 -> 1/x -> 9^(1÷3)
  state.inputDigit('9');
  state.inputPower();
  state.inputDigit('3');
  assert.equal(state.exponentMode, true);
  state.inputReciprocal();

  // Verify all exponent tokens have isExponent: true
  assert.equal(state.rawExpression, '9^(1÷3)');
  assert.equal(state.exponentMode, true);
  const expTokens = state.tokens.slice(2);
  for (const t of expTokens) {
    assert.equal(t.isExponent, true);
  }

  // Evaluates to 9^(1/3) = 2.08008382305
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '2.08008382305');

  // Test unwrap in exponent mode: 9 -> power -> 3 -> 1/x -> 1/x -> 9^3
  state.clearAll();
  state.inputDigit('9');
  state.inputPower();
  state.inputDigit('3');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '9^(1÷3)');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '9^(3)');
  assert.equal(state.tokens[2].char, '3');
  assert.equal(state.tokens[2].isExponent, true);
  const outcome2 = state.evaluate();
  assert.equal(outcome2.success, true);
  assert.equal(outcome2.result, '729');
});

test('exponent button handles unary minus and binary subtraction according to rules 4.1-4.4', () => {
  // 4.1: No '-' symbol before number -> 5^2 = 25
  const s1 = new CalculatorState();
  s1.inputDigit('5');
  s1.inputPower();
  assert.equal(s1.rawExpression, '5^');
  s1.inputDigit('2');
  assert.equal(s1.evaluate().result, '25');

  // 4.2: '-' symbol before number with nothing before '-' -> (-5)^2 = 25
  const s2 = new CalculatorState();
  s2.inputOperator('-'); // unary minus at start
  s2.inputDigit('5');
  s2.inputPower();
  assert.equal(s2.rawExpression, '(-5)^');
  s2.inputDigit('2');
  assert.equal(s2.evaluate().result, '25');

  // 4.2b: '-' before parenthesized term at start -> (-(2+3))^2 = 25
  const s2b = new CalculatorState();
  s2b.inputOperator('-');
  s2b.inputOpenParen();
  s2b.inputDigit('2');
  s2b.inputOperator('+');
  s2b.inputDigit('3');
  s2b.inputCloseParen();
  s2b.inputPower();
  assert.equal(s2b.rawExpression, '(-(2+3))^');
  s2b.inputDigit('2');
  assert.equal(s2b.evaluate().result, '25');

  // 4.3: '-' symbol preceded by an operator -> 1+(-5)^2 = 26
  const s3 = new CalculatorState();
  s3.inputDigit('1');
  s3.inputOperator('+');
  s3.inputDigit('5');
  s3.toggleSign();
  s3.inputPower();
  assert.equal(s3.rawExpression, '1+(-5)^');
  s3.inputDigit('2');
  assert.equal(s3.evaluate().result, '26');

  // 4.3b: 2×-3 -> 2×(-3)^2 = 18
  const s3b = new CalculatorState();
  s3b.inputDigit('2');
  s3b.inputOperator('×');
  s3b.inputDigit('3');
  s3b.toggleSign();
  s3b.inputPower();
  assert.equal(s3b.rawExpression, '2×(-3)^');
  s3b.inputDigit('2');
  assert.equal(s3b.evaluate().result, '18');

  // 4.4: '-' symbol preceded by number (binary subtraction) -> 1-5^2 = -24
  const s4 = new CalculatorState();
  s4.inputDigit('1');
  s4.inputOperator('-'); // binary minus
  s4.inputDigit('5');
  s4.inputPower();
  assert.equal(s4.rawExpression, '1-5^');
  s4.inputDigit('2');
  assert.equal(s4.evaluate().result, '-24');

  // 4.4b: '-' symbol preceded by ')' -> (1-2*3)-5^2 = -30
  const s4b = new CalculatorState();
  s4b.inputOpenParen();
  s4b.inputDigit('1');
  s4b.inputOperator('-');
  s4b.inputDigit('2');
  s4b.inputOperator('×');
  s4b.inputDigit('3');
  s4b.inputCloseParen();
  s4b.inputOperator('-');
  s4b.inputDigit('5');
  s4b.inputPower();
  assert.equal(s4b.rawExpression, '(1-2×3)-5^');
  s4b.inputDigit('2');
  assert.equal(s4b.evaluate().result, '-30');
});

test('pasteExpression parses ^(...) exponent groups and turns off exponentMode after closing paren', () => {
  // Example 1: 2^(1+3)
  const state1 = new CalculatorState();
  assert.equal(state1.pasteExpression('2^(1+3)'), true);
  assert.equal(state1.rawExpression, '2^(1+3)');
  assert.equal(state1.exponentMode, false);
  // Base token '2' is not exponent
  assert.equal(state1.tokens[0].char, '2');
  assert.equal(state1.tokens[0].isExponent, false);
  // Tokens inside (1+3) are all isExponent: true
  const expTokens1 = state1.tokens.slice(2);
  assert.equal(expTokens1.map(t => t.char).join(''), '(1+3)');
  for (const t of expTokens1) {
    assert.equal(t.isExponent, true);
  }
  // Evaluates to 2^4 = 16
  assert.equal(state1.evaluate().result, '16');

  // Example 2: 2^(5)
  const state2 = new CalculatorState();
  assert.equal(state2.pasteExpression('2^(5)'), true);
  assert.equal(state2.rawExpression, '2^(5)');
  assert.equal(state2.exponentMode, false);
  assert.equal(state2.tokens[0].char, '2');
  assert.equal(state2.tokens[0].isExponent, false);
  const expTokens2 = state2.tokens.slice(2);
  assert.equal(expTokens2.map(t => t.char).join(''), '(5)');
  for (const t of expTokens2) {
    assert.equal(t.isExponent, true);
  }
  assert.equal(state2.evaluate().result, '32');

  // Paste 2^(1+3)+4 -> ensures +4 is normal-size (not exponent)
  const state3 = new CalculatorState();
  assert.equal(state3.pasteExpression('2^(1+3)+4'), true);
  assert.equal(state3.rawExpression, '2^(1+3)+4');
  assert.equal(state3.exponentMode, false);
  const lastTokens = state3.tokens.slice(-2);
  assert.equal(lastTokens[0].char, '+');
  assert.equal(lastTokens[0].isExponent, false);
  assert.equal(lastTokens[1].char, '4');
  assert.equal(lastTokens[1].isExponent, false);
  assert.equal(state3.evaluate().result, '20');
});

test('pasteExpression handles standard 2x3 and 100X5.5 multiplication (BUG-002)', () => {
  const state1 = new CalculatorState();
  assert.equal(state1.pasteExpression('2x3'), true);
  assert.equal(state1.rawExpression, '2×3');
  assert.equal(state1.evaluate().result, '6');

  const state2 = new CalculatorState();
  assert.equal(state2.pasteExpression('100X5.5'), true);
  assert.equal(state2.rawExpression, '100×5.5');
  assert.equal(state2.evaluate().result, '550');
});

test('evaluate updates tokens array with auto-closed parentheses (BUG-003)', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputDigit('5');
  state.inputOperator('+');
  state.inputDigit('3');
  assert.equal(state.parenBalance, 1);

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '8');
  assert.equal(state.parenBalance, 0);
  assert.equal(state.tokens[state.tokens.length - 1].kind, 'rparen');
  assert.equal(state.tokens[state.tokens.length - 1].char, ')');
});

test('inputReciprocal wraps compound expression starting with 1÷ rather than corrupting it (BUG-004)', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputDigit('1');
  state.inputOperator('÷');
  state.inputDigit('5');
  state.inputOperator('+');
  state.inputDigit('2');
  state.inputCloseParen();

  assert.equal(state.rawExpression, '(1÷5+2)');
  state.inputReciprocal();
  assert.equal(state.rawExpression, '(1÷(1÷5+2))');

  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  // (1 / 2.2) ~ 0.454545454545
  assert.equal(outcome.result, '0.454545454545');
});

test('inputOperator ignores binary operators directly following open parenthesis (BUG-006)', () => {
  const state = new CalculatorState();
  state.inputOpenParen();
  state.inputOperator('+'); // should be ignored
  assert.equal(state.rawExpression, '(');
  state.inputOperator('×'); // should be ignored
  assert.equal(state.rawExpression, '(');
  state.inputOperator('÷'); // should be ignored
  assert.equal(state.rawExpression, '(');

  state.inputOperator('-'); // unary minus allowed
  assert.equal(state.rawExpression, '(-');
  state.inputDigit('5');
  state.inputCloseParen();
  assert.equal(state.rawExpression, '(-5)');
  assert.equal(state.evaluate().result, '-5');
});

test('inputOperator unary minus directly after power button creates negative exponent without replacing power (BUG-NEW-01)', () => {
  const state = new CalculatorState();
  state.inputDigit('2');
  state.inputPower();
  state.inputOperator('-'); // should be unary minus inside exponent
  state.inputDigit('3');

  assert.equal(state.rawExpression, '2^(-3)');
  const outcome = state.evaluate();
  assert.equal(outcome.success, true);
  assert.equal(outcome.result, '0.125');
});

test('_tokensFromString preserves extreme large and small scientific notation in chain calculation (BUG-NEW-02 & BUG-005)', () => {
  const state1 = new CalculatorState();
  state1.resultString = '1e+25';
  state1.displayState = DisplayState.RESULT;
  state1.inputOperator('+');
  state1.inputDigit('1');
  assert.equal(state1.rawExpression, '1×10^(25)+1');
  assert.equal(state1.evaluate().result, '1e+25');

  const state2 = new CalculatorState();
  state2.resultString = '1e-22';
  state2.displayState = DisplayState.RESULT;
  state2.inputOperator('+');
  state2.inputDigit('1');
  assert.equal(state2.rawExpression, '1×10^(-22)+1');
  assert.equal(state2.evaluate().result, '1');
});
