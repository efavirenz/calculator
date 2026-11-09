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

import {
  evaluateExpression,
  ExpressionError,
  SIGNIFICANT_DIGITS,
  validateSyntax,
} from './expressionParser.js';
import { isEnclosedInParens, isValidToken } from './formatUtils.js';

const MAX_DIGITS_BEFORE_DECIMAL = 15;
const MAX_DIGITS_AFTER_DECIMAL = 15;
const MAX_PASTED_TOKENS = 512;
const BINARY_ARITHMETIC_OPERATORS = new Set(['+', '-', '×', '÷']);

export const DisplayState = Object.freeze({
  ENTRY: 'A',
  RESULT: 'B',
});

function makeToken(char, kind, { isExponent = false, hidden = false } = {}) {
  return { char, kind, isExponent, hidden };
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
    return this._rawExpressionFromTokens(this.tokens);
  }

  /**
   * Serializes any token array into the parser-facing expression string,
   * wrapping contiguous isExponent runs after '^' in parentheses.
   * @param {Array<object>} tokens
   * @returns {string}
   */
  _rawExpressionFromTokens(tokens) {
    let result = '';
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      result += t.char;
      if (t.char === '^') {
        let j = i + 1;
        let expChars = '';
        while (j < tokens.length && tokens[j].isExponent) {
          expChars += tokens[j].char;
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
   * Normalizes clipboard text into the calculator's internal operator
   * alphabet and resolves decimal separators deterministically.
   * @param {string} raw
   * @returns {{text: string, reason: string|null}}
   */
  _normalizePastedInput(raw) {
    let text = String(raw)
      // Unicode minus/dash variants -> ASCII minus.
      .replace(/[−–—﹣]/g, '-')
      .replace(/[⁄∕]/g, '/')
      // Grouping whitespace, currency symbols, and a leading/trailing + sign.
      .replace(/[\s$€£¥₹]/g, '');

    if (text === '') return { text, reason: 'empty' };

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');
    if (hasComma && hasDot) {
      // Locale-aware: the last separator is the decimal separator, the other
      // one is a grouping separator.
      if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
        text = text.replace(/\./g, '').replace(/,/g, '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (hasComma) {
      // A comma without a decimal point is ambiguous (thousands vs decimal).
      // Reject rather than silently misinterpreting the value by a factor of 1000.
      return { text, reason: 'ambiguous' };
    }

    text = text
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/x/gi, '×');

    return { text, reason: null };
  }

  /**
   * Parses clipboard content into a temporary token stream.
   * The live state is not touched until the whole expression validates.
   * @param {string} raw
   * @returns {{tokens: Array<object>|null, reason: string}}
   */
  _parsePastedExpression(raw) {
    const normalized = this._normalizePastedInput(raw);
    const cleaned = normalized.text;
    if (normalized.reason) return { tokens: null, reason: normalized.reason };
    if (!cleaned || !/^[0-9.+\-×÷^()eE]+$/.test(cleaned) || !/\d/.test(cleaned)) {
      return { tokens: null, reason: 'invalid' };
    }

    const tokens = [];
    const numberPattern = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
    const parenStack = [];
    let exponentMode = false;
    let previous = null;
    let index = 0;
    const append = (char, kind, options = {}) => tokens.push(makeToken(char, kind, options));

    while (index < cleaned.length) {
      const ch = cleaned[index];
      if (/[0-9.]/.test(ch)) {
        numberPattern.lastIndex = index;
        const match = numberPattern.exec(cleaned);
        if (!match) return { tokens: null, reason: 'invalid' };
        const literal = match[0];
        const eIndex = literal.search(/[eE]/);
        const mantissa = eIndex < 0 ? literal : literal.slice(0, eIndex);
        const exponent = eIndex < 0 ? null : literal.slice(eIndex + 1);
        const parts = mantissa.split('.');
        const integerPart = parts[0] || '';
        const fractionPart = parts[1] || '';
        if ((integerPart.length || 0) > MAX_DIGITS_BEFORE_DECIMAL || fractionPart.length > MAX_DIGITS_AFTER_DECIMAL) {
          return { tokens: null, reason: 'too-long' };
        }
        if (exponent !== null && (!/^[+-]?\d+$/.test(exponent) || Math.abs(Number(exponent)) > 10000)) {
          return { tokens: null, reason: 'too-long' };
        }
        if (previous === 'rparen') append('×', 'operator', { isExponent: exponentMode });
        if (previous === 'number') return { tokens: null, reason: 'invalid' };

        const normalizedInteger = integerPart || '0';
        for (const digit of normalizedInteger) append(digit, 'digit', { isExponent: exponentMode });
        if (mantissa.includes('.')) append('.', 'decimal', { isExponent: exponentMode });
        for (const digit of fractionPart) append(digit, 'digit', { isExponent: exponentMode });

        if (exponent !== null) {
          append('×', 'operator', { isExponent: exponentMode });
          append('1', 'digit', { isExponent: exponentMode });
          append('0', 'digit', { isExponent: exponentMode });
          append('^', 'operator', { hidden: true });
          append('(', 'lparen', { isExponent: true });
          if (exponent.startsWith('-')) append('-', 'operator', { isExponent: true });
          for (const digit of exponent.replace(/^[+-]/, '')) append(digit, 'digit', { isExponent: true });
          append(')', 'rparen', { isExponent: true });
        }
        index = numberPattern.lastIndex;
        previous = 'number';
        continue;
      }

      if (ch === '(') {
        if (previous === 'number' || previous === 'rparen') append('×', 'operator', { isExponent: exponentMode });
        append('(', 'lparen', { isExponent: exponentMode });
        parenStack.push(exponentMode);
        index += 1;
        previous = 'lparen';
        continue;
      }
      if (ch === ')') {
        if (!parenStack.length || !['number', 'rparen'].includes(previous)) return { tokens: null, reason: 'invalid' };
        append(')', 'rparen', { isExponent: parenStack.pop() });
        exponentMode = parenStack.length ? parenStack[parenStack.length - 1] : false;
        index += 1;
        previous = 'rparen';
        continue;
      }
      if (ch === '^') {
        if (!['number', 'rparen'].includes(previous)) return { tokens: null, reason: 'invalid' };
        append('^', 'operator', { hidden: true });
        exponentMode = true;
        index += 1;
        previous = 'operator';
        continue;
      }
      if ('+-×÷'.includes(ch)) {
        const unary = previous === null || previous === 'operator' || previous === 'lparen';
        if (unary) {
          if (ch === '+') { index += 1; continue; }
          append('-', 'operator', { isExponent: exponentMode });
        } else {
          append(ch, 'operator', { isExponent: exponentMode });
        }
        index += 1;
        previous = 'operator';
        continue;
      }
      return { tokens: null, reason: 'invalid' };
    }

    if (parenStack.length || !['number', 'rparen'].includes(previous)) return { tokens: null, reason: 'invalid' };
    if (tokens.length > MAX_PASTED_TOKENS) return { tokens: null, reason: 'too-long' };
    try {
      validateSyntax(this._rawExpressionFromTokens(tokens));
    } catch {
      return { tokens: null, reason: 'invalid' };
    }
    return { tokens, reason: null };
  }

  /**
   * Inserts an implicit '×' when a newly typed value starts a new factor.
   * A plain digit/decimal continues the number currently being entered, but
   * '(' always starts a new factor; a completed exponent run follows the same
   * rule once exponent entry has been exited (AUD-004).
   * @param {boolean} alwaysAfterValue - also multiply after a plain digit/decimal
   */
  _ensureImplicitMultiplicationBeforeValue(alwaysAfterValue = false) {
    const last = this.tokens[this.tokens.length - 1];
    if (!last) return;
    const endsValue = last.kind === 'digit' || last.kind === 'decimal' || last.kind === 'rparen';
    if (!endsValue) return;

    const exponentRunEnded = Boolean(last.isExponent && !this.exponentMode);
    if (alwaysAfterValue || last.kind === 'rparen' || exponentRunEnded) {
      this.tokens.push(makeToken('×', 'operator', { isExponent: this.exponentMode }));
    }
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

    this._ensureImplicitMultiplicationBeforeValue();
    if (this._leadingDigitLimitReached()) return;
    this.tokens.push(makeToken(digit, 'digit', { isExponent: this.exponentMode }));
  }

  /** Appends a decimal point, guarding against multiple decimals per number. */
  inputDecimal() {
    this._clearErrorIfNeeded();
    this._startFreshIfShowingResult();

    this._ensureImplicitMultiplicationBeforeValue();
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
   * Parses clipboard text into a temporary token stream, validates the complete
   * expression and per-operand digit limits, then commits atomically.
   * Combination policy (AUD-002): when the current expression ends in a value
   * and the pasted text starts with a value, an implicit '×' is inserted
   * instead of silently concatenating digits.
   * @param {string} raw - clipboard text
   * @returns {boolean} true if expression was successfully pasted
   */
  pasteExpression(raw) {
    return this.pasteExpressionWithReason(raw).success;
  }

  /**
   * Same as pasteExpression() but reports why a paste was rejected so the UI
   * can show a specific message.
   * @param {string} raw - clipboard text
   * @returns {{success: boolean, reason?: string}}
   */
  pasteExpressionWithReason(raw) {
    if (typeof raw !== 'string') return { success: false, reason: 'empty' };
    const parsed = this._parsePastedExpression(raw);
    if (!parsed.tokens) return { success: false, reason: parsed.reason };

    const pastedTokens = parsed.tokens;

    // Commit only after full grammar, limit, and parser validation succeeds.
    if (this.displayState === DisplayState.RESULT || this.isError) {
      this.tokens = pastedTokens;
    } else {
      const combined = [...this.tokens];
      const lastToken = combined[combined.length - 1];
      const leftIsValue = Boolean(
        lastToken && (lastToken.kind === 'digit' || lastToken.kind === 'decimal' || lastToken.kind === 'rparen')
      );
      const rightStartsValue = Boolean(
        pastedTokens[0] &&
          (pastedTokens[0].kind === 'digit' || pastedTokens[0].kind === 'decimal' || pastedTokens[0].kind === 'lparen')
      );
      if (leftIsValue && rightStartsValue) {
        combined.push(makeToken('×', 'operator', { isExponent: Boolean(lastToken.isExponent && this.exponentMode) }));
      }
      combined.push(...pastedTokens);
      try {
        validateSyntax(this._rawExpressionFromTokens(combined));
      } catch {
        return { success: false, reason: 'rejected' };
      }
      this.tokens = combined;
    }
    this.displayState = DisplayState.ENTRY;
    this.resultString = null;
    this.errorMessage = null;
    this.exponentMode = false;
    return { success: true };
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

    // NEW-001: a binary arithmetic operator at the top level of an exponent
    // closes the exponent run, matching calculator convention
    // (5 xʸ 2 + 3 = 28). Operators inside an explicitly opened exponent group
    // stay in the exponent (e.g. 9 xʸ ( 1 ÷ 3 )), and '-' immediately after
    // '^' or '(' remains a unary minus inside the exponent (negative exponent).
    if (this.exponentMode && BINARY_ARITHMETIC_OPERATORS.has(op) && !this._hasOpenExponentGroup()) {
      const last = this.tokens[this.tokens.length - 1];
      const staysUnaryExponent =
        op === '-' && (!last || last.kind === 'lparen' || (last.kind === 'operator' && last.char === '^'));
      if (!staysUnaryExponent) {
        this.exponentMode = false;
      }
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
   * Returns the index of a top-level '^' operator within [start, end), or -1.
   * An operator nested inside parentheses is not part of the trailing power.
   */
  _findTopLevelPowerIndex(start, end) {
    let depth = 0;
    for (let i = start; i < end; i += 1) {
      const token = this.tokens[i];
      if (token.kind === 'lparen') depth += 1;
      else if (token.kind === 'rparen') depth -= 1;
      else if (depth === 0 && token.kind === 'operator' && token.char === '^') return i;
    }
    return -1;
  }

  /** True when a token slice is exactly "( - ... )" with matching outer parens. */
  _isWrappedNegativeOperand(tokens) {
    if (tokens.length < 3) return false;
    if (tokens[0].kind !== 'lparen') return false;
    if (tokens[1].kind !== 'operator' || tokens[1].char !== '-') return false;
    let depth = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].kind === 'lparen') depth += 1;
      else if (tokens[i].kind === 'rparen') {
        depth -= 1;
        if (depth === 0 && i < tokens.length - 1) return false;
      }
    }
    return depth === 0;
  }

  /**
   * Toggles the sign of the trailing operand (+/- button).
   *
   * On a power term (base^exponent) the sign applies to the base, matching
   * inputPower()'s auto-wrap: 5^2 -> (-5)^2 -> 5^2.
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

    if (!this.exponentMode) {
      const powerIndex = this._findTopLevelPowerIndex(range.start, range.end);
      if (powerIndex !== -1) {
        const baseTokens = this.tokens.slice(range.start, powerIndex);
        const tailTokens = this.tokens.slice(powerIndex, range.end);
        const before = this.tokens.slice(0, range.start);
        const after = this.tokens.slice(range.end);

        const newBase = this._isWrappedNegativeOperand(baseTokens)
          ? baseTokens.slice(2, -1).map((t) => ({ ...t }))
          : (() => {
              const isExp = Boolean(baseTokens[0]?.isExponent);
              return [
                makeToken('(', 'lparen', { isExponent: isExp }),
                makeToken('-', 'operator', { isExponent: isExp }),
                ...baseTokens,
                makeToken(')', 'rparen', { isExponent: isExp }),
              ];
            })();

        this.tokens = [...before, ...newBase, ...tailTokens, ...after];
        return;
      }
    }

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

    this._ensureImplicitMultiplicationBeforeValue(true);

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

  /**
   * True when the token stream currently has an unclosed '(' that was opened
   * while exponent-entry mode was active. Operators pressed inside such a
   * group belong to the exponent, not to the outer expression.
   */
  _hasOpenExponentGroup() {
    const stack = [];
    for (const token of this.tokens) {
      if (token.kind === 'lparen') stack.push(Boolean(token.isExponent));
      else if (token.kind === 'rparen') stack.pop();
    }
    return stack.length > 0 && stack[stack.length - 1];
  }

  /**
   * Re-derives exponent-entry mode from the new trailing token. A trailing
   * '^' or a token belonging to an exponent run keeps exponent mode active.
   */
  _recomputeExponentMode() {
    const last = this.tokens[this.tokens.length - 1];
    this.exponentMode = Boolean(
      last && ((last.kind === 'operator' && last.char === '^') || last.isExponent)
    );
  }

  /** Backspace: removes one character, honoring the two-state display rules. */
  backspace() {
    if (this.isError) {
      this.errorMessage = null;
      this.displayState = DisplayState.ENTRY;
      if (this.tokens.length > 0) this.tokens.pop();
      this._recomputeExponentMode();
      return;
    }

    if (this.displayState === DisplayState.RESULT) {
      // Backspace on the showed answer (lower display), switch to State A (upper cleared)
      this.tokens = this._tokensFromString(this.resultString || '');
      this.displayState = DisplayState.ENTRY;
      this.resultString = null;
      if (this.tokens.length > 0) {
        this.tokens.pop();
      }
      this._recomputeExponentMode();
      return;
    }

    if (this.tokens.length === 0) return;

    this.tokens.pop();
    this._recomputeExponentMode();
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
   * Malformed or empty token arrays fall back to the legacy result-only path.
   * @param {Array<object>} tokens - expression tokens to restore
   * @param {string} result - formatted result string
   */
  loadFromHistory(tokens, result) {
    const safeTokens = Array.isArray(tokens) ? tokens.filter(isValidToken) : [];
    if (safeTokens.length === 0 || safeTokens.length !== tokens.length) {
      return this.loadResultOnly(result);
    }
    this.tokens = safeTokens.map((t) => ({ ...t }));
    this.resultString = result;
    this.displayState = DisplayState.RESULT;
    this.exponentMode = false;
    this.errorMessage = null;
    return true;
  }

  /**
   * Legacy history restore: rebuilds an editable expression from a stored
   * result string. Encapsulates token reconstruction so app.js never mutates
   * private state (AUD-016).
   * @param {string} result
   * @returns {boolean} false when the result cannot be converted to tokens
   */
  loadResultOnly(result) {
    const tokens = this._tokensFromString(result);
    if (tokens.length === 0) return false;
    this.tokens = tokens;
    this.resultString = null;
    this.displayState = DisplayState.ENTRY;
    this.exponentMode = false;
    this.errorMessage = null;
    return true;
  }

  /**
   * =: evaluates the current expression. Auto-closes any unclosed
   * parentheses before evaluating (documented ambiguity resolution;
   * see README).
   *
   * Evaluation runs on a working copy: auto-closed parentheses (and the
   * convenience trailing-operator trim) are committed to the live token
   * stream only when evaluation succeeds (NEW-002).
   */
  evaluate() {
    if (this.isEmpty) return;

    const workingTokens = this.tokens.map((t) => ({ ...t }));

    // Preserve incomplete powers and unary exponent signs; only retain the
    // established convenience behavior for a trailing binary arithmetic op.
    const last = workingTokens[workingTokens.length - 1];
    if (last?.kind === 'operator') {
      const isExponentSyntax = last.char === '^' || last.isExponent;
      const isBinaryArithmetic = BINARY_ARITHMETIC_OPERATORS.has(last.char) && !last.isExponent;
      if (isExponentSyntax || !isBinaryArithmetic) {
        this.errorMessage = 'Incomplete expression';
        return { success: false, error: this.errorMessage };
      }
      workingTokens.pop();
    }

    if (workingTokens.length === 0) return;

    const openParenFlags = [];
    for (const token of workingTokens) {
      if (token.kind === 'lparen') openParenFlags.push(Boolean(token.isExponent));
      else if (token.kind === 'rparen') openParenFlags.pop();
    }
    while (openParenFlags.length) {
      workingTokens.push(makeToken(')', 'rparen', { isExponent: openParenFlags.pop() }));
    }

    const expr = this._rawExpressionFromTokens(workingTokens);

    try {
      const result = evaluateExpression(expr);
      this.tokens = workingTokens;
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
        const decimals = absNum < 1 ? 20 : Math.max(0, SIGNIFICANT_DIGITS - Math.floor(Math.log10(absNum)) - 1);
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
