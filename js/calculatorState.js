/**
 * calculatorState.js
 *
 * Owns the calculator's data model: the token stream that makes up
 * the current expression, plus display-mode bookkeeping (State A vs
 * State B, exponent-entry mode, error state).
 *
 * IMPORTANT: This module never touches the DOM. It exposes plain
 * data and mutator methods; UI rendering is the caller's job
 * (see uiRenderer.js).
 *
 * Token shape:
 *   {
 *     char: '1' | '+' | '(' | ')' | '.' | ...
 *     kind: 'digit' | 'decimal' | 'operator' | 'lparen' | 'rparen'
 *     isExponent: boolean   // render as superscript
 *     hidden: boolean       // never render, but still counts for eval
 *   }
 *
 * DISPLAY_STATE:
 *   'A' -> upper display empty, lower display shows live expression
 *   'B' -> upper display shows expression, lower shows result
 */

import { evaluateExpression, ExpressionError } from './expressionParser.js';

const MAX_DIGITS_BEFORE_DECIMAL = 15;

export const DisplayState = Object.freeze({
  ENTRY: 'A',
  RESULT: 'B',
});

function makeToken(char, kind, { isExponent = false, hidden = false } = {}) {
  return { char, kind, isExponent, hidden };
}

export class CalculatorState {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {Array<object>} */
    this.tokens = [];
    this.displayState = DisplayState.ENTRY;
    this.resultString = null;
    this.exponentMode = false;
    this.errorMessage = null;
  }

  get isError() {
    return this.errorMessage !== null;
  }

  /** Count of unmatched '(' tokens across the whole token stream. */
  get parenBalance() {
    let balance = 0;
    for (const t of this.tokens) {
      if (t.kind === 'lparen') balance += 1;
      if (t.kind === 'rparen') balance -= 1;
    }
    return balance;
  }

  get isEmpty() {
    return this.tokens.length === 0;
  }

  /** Raw string handed to the expression parser (ignores hidden flag). */
  get rawExpression() {
    return this.tokens.map((t) => t.char).join('');
  }

  /**
   * Finds the index range [start, end) of the trailing numeric term
   * (contiguous run of digit/decimal tokens, optionally preceded by a
   * unary minus token) or the trailing fully-closed parenthesized
   * group. Used by the 1/x transform and the +/- toggle.
   * Returns null if there is no valid trailing operand.
   */
  _findTrailingOperandRange() {
    const n = this.tokens.length;
    if (n === 0) return null;

    const last = this.tokens[n - 1];

    if (last.kind === 'rparen') {
      // Walk backwards to find the matching '('.
      let depth = 0;
      let i = n - 1;
      while (i >= 0) {
        if (this.tokens[i].kind === 'rparen') depth += 1;
        else if (this.tokens[i].kind === 'lparen') depth -= 1;
        if (depth === 0) break;
        i -= 1;
      }
      if (i < 0) return null;
      return { start: i, end: n, kind: 'paren' };
    }

    if (last.kind === 'digit' || last.kind === 'decimal') {
      let i = n - 1;
      while (i >= 0 && (this.tokens[i].kind === 'digit' || this.tokens[i].kind === 'decimal')) {
        i -= 1;
      }
      // Include a leading unary minus if present (i.e. '-' preceded by
      // nothing, an operator, or an open paren).
      const numStart = i + 1;
      if (i >= 0 && this.tokens[i].kind === 'operator' && this.tokens[i].char === '-') {
        const before = this.tokens[i - 1];
        const isUnary = !before || before.kind === 'operator' || before.kind === 'lparen';
        if (isUnary) {
          return { start: i, end: n, kind: 'number' };
        }
      }
      return { start: numStart, end: n, kind: 'number' };
    }

    return null;
  }

  /**
   * Appends a digit (0-9). Behaves according to current mode:
   * entry mode -> extends the current number; exponent mode -> extends
   * the exponent (marked isExponent); result state -> starts a fresh
   * expression (iOS-like behavior).
   */
  inputDigit(digit) {
    this._clearErrorIfNeeded();
    this._startFreshIfShowingResult();

    if (this._leadingDigitLimitReached()) return;

    this.tokens.push(makeToken(digit, 'digit', { isExponent: this.exponentMode }));
  }

  /** Appends a decimal point, guarding against multiple decimals per number. */
  inputDecimal() {
    this._clearErrorIfNeeded();
    this._startFreshIfShowingResult();

    const range = this._trailingNumberHasDecimal();
    if (range.hasDecimal) return; // no-op: malformed decimal guard

    if (range.isEmpty) {
      // Leading decimal, e.g. ".5" -> prefix with "0".
      this.tokens.push(makeToken('0', 'digit', { isExponent: this.exponentMode }));
    }
    this.tokens.push(makeToken('.', 'decimal', { isExponent: this.exponentMode }));
  }

  _trailingNumberHasDecimal() {
    let i = this.tokens.length - 1;
    let sawDigit = false;
    while (i >= 0 && (this.tokens[i].kind === 'digit' || this.tokens[i].kind === 'decimal')) {
      if (this.tokens[i].kind === 'decimal') return { hasDecimal: true, isEmpty: false };
      sawDigit = true;
      i -= 1;
    }
    return { hasDecimal: false, isEmpty: !sawDigit };
  }

  _leadingDigitLimitReached() {
    let i = this.tokens.length - 1;
    let digitCount = 0;
    while (i >= 0 && (this.tokens[i].kind === 'digit' || this.tokens[i].kind === 'decimal')) {
      if (this.tokens[i].kind === 'digit') digitCount += 1;
      i -= 1;
    }
    return digitCount >= MAX_DIGITS_BEFORE_DECIMAL;
  }

  /** Appends a binary operator: + - × ÷ */
  inputOperator(op) {
    this._clearErrorIfNeeded();

    if (this.displayState === DisplayState.RESULT) {
      // iOS-like: continue calculating from the previous result.
      this.tokens = this._tokensFromString(this.resultString);
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
    }

    this.exponentMode = false;

    if (this.isEmpty) {
      if (op === '-') {
        // Leading unary minus is allowed ("start with a negative number").
        this.tokens.push(makeToken('-', 'operator'));
      }
      return; // other leading operators are a no-op
    }

    const last = this.tokens[this.tokens.length - 1];
    if (last.kind === 'operator') {
      // Replace a trailing operator instead of stacking two in a row.
      this.tokens[this.tokens.length - 1] = makeToken(op, 'operator');
      return;
    }

    this.tokens.push(makeToken(op, 'operator'));
  }

  /**
   * x^y button: inserts a hidden '^' operator and enters exponent-entry
   * mode so subsequent digits render as superscript.
   */
  inputPower() {
    this._clearErrorIfNeeded();

    if (this.displayState === DisplayState.RESULT) {
      this.tokens = this._tokensFromString(this.resultString);
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
    }

    if (this.isEmpty) return; // no base to exponentiate, no-op

    const last = this.tokens[this.tokens.length - 1];
    if (last.kind === 'operator') return; // no operand before an operator

    this.tokens.push(makeToken('^', 'operator', { hidden: true }));
    this.exponentMode = true;
  }

  /**
   * 1/x button: rewraps the trailing operand as (operand)^(-1).
   */
  inputReciprocal() {
    this._clearErrorIfNeeded();

    if (this.displayState === DisplayState.RESULT) {
      this.tokens = this._tokensFromString(this.resultString);
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
    }

    const range = this._findTrailingOperandRange();
    if (!range) return; // no valid trailing operand: no-op

    const operand = this.tokens.slice(range.start, range.end);
    const before = this.tokens.slice(0, range.start);

    const wrapped = [
      makeToken('(', 'lparen'),
      ...operand,
      makeToken(')', 'rparen'),
      makeToken('^', 'operator', { hidden: true }),
      makeToken('(', 'lparen', { hidden: true }),
      makeToken('-', 'operator', { isExponent: true }),
      makeToken('1', 'digit', { isExponent: true }),
      makeToken(')', 'rparen', { hidden: true }),
    ];

    this.tokens = [...before, ...wrapped];
    this.exponentMode = false;
  }

  /**
   * Toggles the sign of the trailing operand (+/- button).
   */
  toggleSign() {
    this._clearErrorIfNeeded();
    if (this.displayState === DisplayState.RESULT) {
      // Toggle the sign of the finished result directly.
      if (this.resultString.startsWith('-')) {
        this.resultString = this.resultString.slice(1);
      } else if (this.resultString !== '0') {
        this.resultString = `-${this.resultString}`;
      }
      this.tokens = this._tokensFromString(this.resultString);
      return;
    }

    const range = this._findTrailingOperandRange();
    if (!range) return;

    const first = this.tokens[range.start];
    if (first.kind === 'operator' && first.char === '-') {
      // Already negative: remove the unary minus.
      this.tokens.splice(range.start, 1);
    } else {
      this.tokens.splice(range.start, 0, makeToken('-', 'operator'));
    }
  }

  /** ( button: always available. */
  inputOpenParen() {
    this._clearErrorIfNeeded();
    this._startFreshIfShowingResult();
    this.tokens.push(makeToken('(', 'lparen', { isExponent: this.exponentMode }));
  }

  /** ) button: only valid while parenBalance > 0. */
  inputCloseParen() {
    this._clearErrorIfNeeded();
    if (this.parenBalance <= 0) return; // disabled: no-op
    this.tokens.push(makeToken(')', 'rparen', { isExponent: this.exponentMode }));
  }

  /** Backspace: removes one character, honoring the two-state display rules. */
  backspace() {
    if (this.isError) {
      this.reset();
      return;
    }

    if (this.displayState === DisplayState.RESULT) {
      // Backspace on the showed answer (lower display), switch to State A (upper cleared)
      this.tokens = this._tokensFromString(this.resultString || '');
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
      this.exponentMode = false;
      if (this.tokens.length > 0) {
        this.tokens.pop();
      }
      return;
    }

    if (this.tokens.length === 0) return;

    const removed = this.tokens.pop();
    if (removed.kind === 'operator' && removed.char === '^') {
      this.exponentMode = false;
    }
    // Recompute exponentMode based on whether the new trailing run is
    // still marked as exponent content.
    const last = this.tokens[this.tokens.length - 1];
    this.exponentMode = Boolean(last && last.isExponent && last.kind !== 'operator');
  }

  /** AC: full reset. */
  clearAll() {
    this.reset();
  }

  /**
   * Moves the frozen upper-line expression down into the editable
   * lower line without deleting anything (used when the user taps the
   * upper display line directly to resume editing it). No-op unless
   * currently showing a result (State B).
   */
  recallExpressionToEntry() {
    if (this.displayState !== DisplayState.RESULT) return;
    this.displayState = DisplayState.ENTRY;
    this.resultString = null;
  }

  /**
   * Restores a full expression + result pair (e.g. from a tapped
   * History entry) and displays it as a finished calculation (State
   * B), exactly as if '=' had just been pressed.
   * @param {Array<object>} tokens - expression tokens to restore
   * @param {string} result - formatted result string
   */
  loadFromHistory(tokens, result) {
    this.tokens = tokens.map((t) => ({ ...t }));
    this.resultString = result;
    this.displayState = DisplayState.RESULT;
    this.exponentMode = false;
    this.errorMessage = null;
  }

  /**
   * =: evaluates the current expression. Auto-closes any unclosed
   * parentheses before evaluating (documented ambiguity resolution;
   * see README).
   */
  evaluate() {
    if (this.isEmpty) return;

    let expr = this.rawExpression;
    const balance = this.parenBalance;
    if (balance > 0) {
      expr += ')'.repeat(balance);
    }

    try {
      const result = evaluateExpression(expr);
      this.resultString = result;
      this.displayState = DisplayState.RESULT;
      this.exponentMode = false;
      this.errorMessage = null;
      return { success: true, expression: this.getExpressionDisplayTokens(), result };
    } catch (err) {
      this.errorMessage = err instanceof ExpressionError ? err.message : 'Error';
      return { success: false, error: this.errorMessage };
    }
  }

  _clearErrorIfNeeded() {
    if (this.isError) {
      this.tokens = [];
      this.errorMessage = null;
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
      this.exponentMode = false;
    }
  }

  _startFreshIfShowingResult() {
    if (this.displayState === DisplayState.RESULT) {
      this.tokens = [];
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
    }
  }

  /** Rebuilds a plain token array from a formatted result string. */
  _tokensFromString(str) {
    const tokens = [];
    for (const ch of str) {
      if (ch === '-') tokens.push(makeToken('-', 'operator'));
      else if (ch === '.') tokens.push(makeToken('.', 'decimal'));
      else if (ch === 'e' || ch === '+') {
        // Exponential notation from formatNumber isn't re-editable;
        // fall back to treating it as opaque digits is unsafe, so we
        // just stop including further characters. Rare edge case.
        break;
      } else tokens.push(makeToken(ch, 'digit'));
    }
    return tokens;
  }

  /**
   * Returns the token list to render for the "expression" line
   * (used for both the live lower display in State A and the frozen
   * upper display in State B).
   */
  getExpressionDisplayTokens() {
    return this.tokens;
  }
}
