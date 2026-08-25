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
const MAX_DIGITS_AFTER_DECIMAL = 15;

export const DisplayState = Object.freeze({
  ENTRY: 'A',
  RESULT: 'B',
});

function makeToken(char, kind, { isExponent = false, hidden = false } = {}) {
  return { char, kind, isExponent, hidden };
}

function isEnclosedInParens(str) {
  if (!str.startsWith('(') || !str.endsWith(')')) return false;
  let depth = 0;
  for (let k = 0; k < str.length; k += 1) {
    if (str[k] === '(') depth += 1;
    else if (str[k] === ')') {
      depth -= 1;
      if (depth === 0 && k < str.length - 1) return false;
    }
  }
  return depth === 0;
}

function isSingleAtomicOperand(tokens) {
  if (!tokens || tokens.length === 0) return false;
  let allNumeric = true;
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.kind === 'digit' || t.kind === 'decimal' || (k === 0 && t.kind === 'operator' && t.char === '-')) {
      continue;
    }
    allNumeric = false;
    break;
  }
  if (allNumeric) return true;

  if (tokens[0].kind === 'lparen' && tokens[tokens.length - 1].kind === 'rparen') {
    let depth = 0;
    for (let k = 0; k < tokens.length; k += 1) {
      if (tokens[k].kind === 'lparen') depth += 1;
      else if (tokens[k].kind === 'rparen') {
        depth -= 1;
        if (depth === 0 && k < tokens.length - 1) return false;
      }
    }
    return depth === 0;
  }
  return false;
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

  /**
   * Determines whether the xʸ (power) button can be pressed.
   * Enabled only when:
   * 1. Actively in exponent mode (allows toggling off).
   * 2. Displaying a completed result in State B.
   * 3. The trailing token in the active expression is a number (digit or decimal) or closing parenthesis.
   * @returns {boolean}
   */
  get isPowerEnabled() {
    if (this.isError) return false;
    if (this.exponentMode) return true; // Can always toggle off
    if (this.displayState === DisplayState.RESULT) {
      return this.resultString !== null;
    }
    if (this.isEmpty) return false;
    const last = this.tokens[this.tokens.length - 1];
    return Boolean(last && (last.kind === 'digit' || last.kind === 'decimal' || last.kind === 'rparen'));
  }

  /**
   * Determines whether the 1/x (reciprocal) button can be pressed.
   * Enabled only when:
   * 1. Displaying a completed result in State B.
   * 2. The trailing token in the active expression is a number (digit or decimal) or closing parenthesis.
   * @returns {boolean}
   */
  get isReciprocalEnabled() {
    if (this.isError) return false;
    if (this.displayState === DisplayState.RESULT) {
      return this.resultString !== null;
    }
    if (this.isEmpty) return false;
    const last = this.tokens[this.tokens.length - 1];
    return Boolean(last && (last.kind === 'digit' || last.kind === 'decimal' || last.kind === 'rparen'));
  }

  /**
   * Determines whether the +/- (sign toggle) button can be pressed.
   * Enabled only when:
   * 1. Displaying a completed result in State B.
   * 2. The trailing token in the active expression is a number (digit or decimal) or closing parenthesis.
   * @returns {boolean}
   */
  get isSignEnabled() {
    if (this.isError) return false;
    if (this.displayState === DisplayState.RESULT) {
      return this.resultString !== null;
    }
    if (this.isEmpty) return false;
    const last = this.tokens[this.tokens.length - 1];
    return Boolean(last && (last.kind === 'digit' || last.kind === 'decimal' || last.kind === 'rparen'));
  }

  /** Raw string handed to the expression parser (wraps exponent runs in parentheses). */
  get rawExpression() {
    let result = '';
    let i = 0;
    while (i < this.tokens.length) {
      const t = this.tokens[i];
      result += t.char;
      if (t.char === '^') {
        let j = i + 1;
        let expChars = '';
        while (j < this.tokens.length && this.tokens[j].isExponent) {
          expChars += this.tokens[j].char;
          j += 1;
        }
        if (expChars.length > 0) {
          if (isEnclosedInParens(expChars)) {
            result += expChars;
          } else {
            result += `(${expChars})`;
          }
          i = j;
          continue;
        }
      }
      i += 1;
    }
    return result;
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

    let end = n;
    let start = this._findSingleOperandStart(end);
    if (start === null) return null;

    // If not actively entering exponent digits and preceded by '^',
    // include the base in the trailing term (e.g. for reciprocal chaining).
    if (!this.exponentMode && start > 0 && this.tokens[start - 1].kind === 'operator' && this.tokens[start - 1].char === '^') {
      const baseStart = this._findSingleOperandStart(start - 1);
      if (baseStart !== null) {
        start = baseStart;
      }
    }

    return { start, end, kind: 'term' };
  }

  _findSingleOperandStart(end) {
    if (end <= 0) return null;
    const last = this.tokens[end - 1];

    if (last.kind === 'rparen') {
      let depth = 0;
      let i = end - 1;
      while (i >= 0) {
        if (this.tokens[i].kind === 'rparen') depth += 1;
        else if (this.tokens[i].kind === 'lparen') depth -= 1;
        if (depth === 0) break;
        i -= 1;
      }
      if (i < 0) return null;

      // Include a leading unary minus if present before the '('
      if (i > 0 && this.tokens[i - 1].kind === 'operator' && this.tokens[i - 1].char === '-') {
        const before = i > 1 ? this.tokens[i - 2] : null;
        const isUnary = !before || before.kind === 'operator' || before.kind === 'lparen';
        if (isUnary) {
          return i - 1;
        }
      }
      return i;
    }

    if (last.kind === 'digit' || last.kind === 'decimal') {
      let i = end - 1;
      while (i >= 0 && (this.tokens[i].kind === 'digit' || this.tokens[i].kind === 'decimal')) {
        i -= 1;
      }
      const numStart = i + 1;
      if (i >= 0 && this.tokens[i].kind === 'operator' && this.tokens[i].char === '-') {
        const before = i > 0 ? this.tokens[i - 1] : null;
        const isUnary = !before || before.kind === 'operator' || before.kind === 'lparen';
        if (isUnary) {
          return i;
        }
      }
      return numStart;
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
    while (i >= 0 && (this.tokens[i].kind === 'digit' || this.tokens[i].kind === 'decimal')) {
      i -= 1;
    }
    const start = i + 1;
    let integerDigits = 0;
    let fractionalDigits = 0;
    let seenDecimal = false;

    for (let j = start; j < this.tokens.length; j += 1) {
      if (this.tokens[j].kind === 'decimal') {
        seenDecimal = true;
      } else if (this.tokens[j].kind === 'digit') {
        if (seenDecimal) {
          fractionalDigits += 1;
        } else {
          integerDigits += 1;
        }
      }
    }

    if (seenDecimal) {
      return fractionalDigits >= MAX_DIGITS_AFTER_DECIMAL;
    }
    return integerDigits >= MAX_DIGITS_BEFORE_DECIMAL;
  }

  /**
   * Appends a pasted expression or numeric string to the current equation.
   * Normalizes multiply/divide symbols, strips whitespace, commas, and currency symbols.
   * Feeds tokens through existing input methods to respect digit limits, decimal rules, and syntax guards.
   * @param {string} raw - clipboard text
   * @returns {boolean} true if expression was successfully pasted
   */
  pasteExpression(raw) {
    if (typeof raw !== 'string') return false;

    // Strip thousands separators (commas), whitespace, and common currency symbols
    // Also normalize text variants: * -> ×, / -> ÷, x/X -> ×
    const cleaned = raw
      .replace(/[,\s$€£¥₹]/g, '')
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/x/gi, '×');

    if (!cleaned) return false;

    // Validate: must contain only allowed calculator characters
    if (!/^[0-9.+\-×÷^()]+$/.test(cleaned)) return false;
    // Must contain at least one digit
    if (!/\d/.test(cleaned)) return false;

    this._clearErrorIfNeeded();
    this._startFreshIfShowingResult();

    let expectExpParen = false;
    let inExpGroup = false;
    let expParenDepth = 0;

    for (const ch of cleaned) {
      if (expectExpParen) {
        if (ch === '(') {
          inExpGroup = true;
          expParenDepth = 1;
        }
        expectExpParen = false;
      } else if (inExpGroup) {
        if (ch === '(') {
          expParenDepth += 1;
        }
      }

      if (ch >= '0' && ch <= '9') {
        this.inputDigit(ch);
      } else if (ch === '.') {
        this.inputDecimal();
      } else if (ch === '+') {
        this.inputOperator('+');
      } else if (ch === '-') {
        this.inputOperator('-');
      } else if (ch === '×') {
        this.inputOperator('×');
      } else if (ch === '÷') {
        this.inputOperator('÷');
      } else if (ch === '^') {
        this.inputPower();
        expectExpParen = true;
      } else if (ch === '(') {
        this.inputOpenParen();
      } else if (ch === ')') {
        this.inputCloseParen();
        if (inExpGroup) {
          expParenDepth -= 1;
          if (expParenDepth <= 0) {
            inExpGroup = false;
            this.exponentMode = false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Backward-compatible alias for pasteExpression.
   * @param {string} raw
   * @returns {boolean}
   */
  pasteNumber(raw) {
    return this.pasteExpression(raw);
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

    if (this.isEmpty) {
      if (op === '-') {
        // Leading unary minus is allowed ("start with a negative number").
        this.tokens.push(makeToken('-', 'operator', { isExponent: this.exponentMode }));
      }
      return; // other leading operators are a no-op
    }

    const last = this.tokens[this.tokens.length - 1];
    if (last.kind === 'lparen') {
      if (op === '-') {
        this.tokens.push(makeToken('-', 'operator', { isExponent: this.exponentMode }));
      }
      return;
    }

    if (last.kind === 'operator' && last.char === '^') {
      if (op === '-') {
        this.tokens.push(makeToken('-', 'operator', { isExponent: true }));
      }
      return;
    }

    if (last.kind === 'operator') {
      // Replace a trailing operator instead of stacking two in a row.
      this.tokens[this.tokens.length - 1] = makeToken(op, 'operator', { isExponent: this.exponentMode });
      return;
    }

    this.tokens.push(makeToken(op, 'operator', { isExponent: this.exponentMode }));
  }

  /**
   * x^y button: inserts a hidden '^' operator and enters exponent-entry
   * mode so subsequent digits render as superscript.
   * Pressing again while already in exponent mode exits back to normal.
   */
  inputPower() {
    this._clearErrorIfNeeded();

    // Toggle OFF: pressing xʸ while already in exponent mode exits it
    if (this.exponentMode) {
      this.exponentMode = false;
      return;
    }

    if (this.displayState === DisplayState.RESULT) {
      this.tokens = this._tokensFromString(this.resultString);
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
    }

    if (this.isEmpty) return; // no base to exponentiate, no-op

    const last = this.tokens[this.tokens.length - 1];
    if (last.kind === 'operator') return; // no operand before an operator

    // Auto-wrap unary minus before trailing operand into (-operand)
    const start = this._findSingleOperandStart(this.tokens.length);
    if (start !== null && this.tokens[start].kind === 'operator' && this.tokens[start].char === '-') {
      const operandTokens = this.tokens.slice(start);
      const beforeTokens = this.tokens.slice(0, start);
      const isExp = Boolean(this.tokens[start]?.isExponent);
      const wrappedBase = [
        makeToken('(', 'lparen', { isExponent: isExp }),
        ...operandTokens,
        makeToken(')', 'rparen', { isExponent: isExp }),
      ];
      this.tokens = [...beforeTokens, ...wrappedBase];
    }

    this.tokens.push(makeToken('^', 'operator', { hidden: true }));
    this.exponentMode = true;
  }

  /**
   * 1/x button: wraps trailing operand as (1÷operand), or unwraps if already (1÷x).
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
    const isExp = Boolean(this.tokens[range.start]?.isExponent || this.exponentMode);

    // Check if operand is already wrapped as (1÷x) where x is a single atomic operand
    if (
      operand.length >= 4 &&
      operand[0].kind === 'lparen' &&
      operand[1].kind === 'digit' &&
      operand[1].char === '1' &&
      operand[2].kind === 'operator' &&
      operand[2].char === '÷' &&
      operand[operand.length - 1].kind === 'rparen' &&
      isSingleAtomicOperand(operand.slice(3, operand.length - 1))
    ) {
      // Unwrap back to x
      const unwrapped = operand.slice(3, operand.length - 1);
      this.tokens = [...before, ...unwrapped];
    } else {
      // Wrap as (1÷operand)
      const wrapped = [
        makeToken('(', 'lparen', { isExponent: isExp }),
        makeToken('1', 'digit', { isExponent: isExp }),
        makeToken('÷', 'operator', { isExponent: isExp }),
        ...operand,
        makeToken(')', 'rparen', { isExponent: isExp }),
      ];
      this.tokens = [...before, ...wrapped];
    }

    this.exponentMode = isExp;
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
      const isExponent = Boolean(this.tokens[range.start]?.isExponent);
      this.tokens.splice(range.start, 0, makeToken('-', 'operator', { isExponent }));
    }
  }

  /** ( button: always available. */
  inputOpenParen() {
    this._clearErrorIfNeeded();
    this._startFreshIfShowingResult();

    const last = this.tokens[this.tokens.length - 1];
    if (last && (last.kind === 'digit' || last.kind === 'decimal' || last.kind === 'rparen')) {
      this.tokens.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
    }

    this.tokens.push(makeToken('(', 'lparen', { isExponent: this.exponentMode }));
  }

  /** ) button: only valid while parenBalance > 0. */
  inputCloseParen() {
    this._clearErrorIfNeeded();
    if (this.parenBalance <= 0) return; // disabled: no-op
    const last = this.tokens[this.tokens.length - 1];
    if (last && (last.kind === 'operator' || last.kind === 'lparen')) return;
    this.tokens.push(makeToken(')', 'rparen', { isExponent: this.exponentMode }));
  }

  /** Backspace: removes one character, honoring the two-state display rules. */
  backspace() {
    if (this.isError) {
      this.errorMessage = null;
      this.displayState = DisplayState.ENTRY;
      if (this.tokens.length > 0) this.tokens.pop();
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
    // still marked as exponent content or follows a hidden '^' operator.
    const last = this.tokens[this.tokens.length - 1];
    this.exponentMode = Boolean(
      last && ((last.kind === 'operator' && last.char === '^') || last.isExponent)
    );
  }

  /** AC: full reset. */
  clearAll() {
    this.reset();
  }

  /**
   * Moves the frozen upper-line expression down into the editable
   * lower line without deleting anything (used when the user taps the
   * upper display line directly to resume editing it).
   */
  recallExpressionToEntry() {
    if (this.displayState !== DisplayState.RESULT && !this.isError) return;
    this.displayState = DisplayState.ENTRY;
    this.resultString = null;
    this.errorMessage = null;
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

    // Strip any trailing operator tokens before evaluating (e.g. '61+' -> '61')
    while (
      this.tokens.length > 0 &&
      this.tokens[this.tokens.length - 1].kind === 'operator'
    ) {
      this.tokens.pop();
    }

    if (this.isEmpty) return;

    const balance = this.parenBalance;
    if (balance > 0) {
      for (let b = 0; b < balance; b += 1) {
        this.tokens.push(makeToken(')', 'rparen', { isExponent: false }));
      }
    }

    const expr = this.rawExpression;

    try {
      const result = evaluateExpression(expr);
      this.resultString = result;
      this.displayState = DisplayState.RESULT;
      this.exponentMode = false;
      this.errorMessage = null;
      return { success: true, expression: this.tokens.map((t) => ({ ...t })), result };
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
    if (!str || typeof str !== 'string') return [];
    const num = Number(str);
    if (!Number.isFinite(num)) return [];

    let formattedStr = str;
    if (str.includes('e') || str.includes('E')) {
      const absNum = Math.abs(num);
      if (absNum >= 1e-15 && absNum < 1e20) {
        const decimals = absNum < 1 ? 20 : Math.max(0, 12 - Math.floor(Math.log10(absNum)) - 1);
        const fixed = num.toFixed(Math.min(decimals, 20));
        const cleaned = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
        if (!cleaned.includes('e') && cleaned !== '0' && cleaned !== '-0') {
          formattedStr = cleaned;
        }
      }
    }

    if (!formattedStr.includes('e') && !formattedStr.includes('E')) {
      const tokens = [];
      for (const ch of formattedStr) {
        if (ch === '-') tokens.push(makeToken('-', 'operator'));
        else if (ch === '.') tokens.push(makeToken('.', 'decimal'));
        else if (ch >= '0' && ch <= '9') tokens.push(makeToken(ch, 'digit'));
      }
      return tokens;
    }

    const [mantissaStr, expStr] = formattedStr.toLowerCase().split('e');
    const expNum = parseInt(expStr, 10);
    if (Number.isNaN(expNum)) return [];

    const tokens = [];
    if (mantissaStr.startsWith('-')) {
      tokens.push(makeToken('-', 'operator'));
    }
    const unsignedMantissa = mantissaStr.replace(/^-/, '');
    for (const ch of unsignedMantissa) {
      if (ch === '.') tokens.push(makeToken('.', 'decimal'));
      else if (ch >= '0' && ch <= '9') tokens.push(makeToken(ch, 'digit'));
    }

    tokens.push(makeToken('×', 'operator'));
    tokens.push(makeToken('1', 'digit'));
    tokens.push(makeToken('0', 'digit'));
    tokens.push(makeToken('^', 'operator', { hidden: true }));

    const expAbsStr = String(Math.abs(expNum));
    if (expNum < 0) {
      tokens.push(makeToken('-', 'operator', { isExponent: true }));
    }
    for (const ch of expAbsStr) {
      tokens.push(makeToken(ch, 'digit', { isExponent: true }));
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
