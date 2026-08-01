/**
 * formatUtils.js
 *
 * Small pure helpers shared across modules. Currently: converting a
 * token stream into a single plain-text string (with Unicode
 * superscript characters standing in for <sup> markup) for contexts
 * that can't render DOM, such as history list text content.
 */

const SUPERSCRIPT_MAP = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '-': '⁻',
  '.': '˙',
};

/**
 * @param {Array<{char:string, isExponent:boolean, hidden:boolean, kind:string}>} tokens
 * @returns {string}
 */
export function tokensToPlainText(tokens) {
  let out = '';
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.hidden) { i += 1; continue; }

    if (!token.isExponent && (token.kind === 'digit' || token.kind === 'decimal')) {
      // Collect the full number string then strip leading zeros.
      let numStr = '';
      while (
        i < tokens.length &&
        !tokens[i].hidden &&
        !tokens[i].isExponent &&
        (tokens[i].kind === 'digit' || tokens[i].kind === 'decimal')
      ) {
        numStr += tokens[i].char;
        i += 1;
      }
      out += stripLeadingZeros(numStr);
      continue;
    }

    if (token.isExponent) {
      out += SUPERSCRIPT_MAP[token.char] ?? token.char;
    } else {
      out += token.char;
    }
    i += 1;
  }
  return out;
}

/**
 * Strips leading zeros from the integer part of a number string,
 * while preserving a single leading zero before a decimal point
 * (e.g. "0.5" stays "0.5") and leaving scientific notation intact.
 * Examples: "001" → "1", "001.5" → "1.5", "0.001" → "0.001".
 * @param {string} numStr
 * @returns {string}
 */
export function stripLeadingZeros(numStr) {
  if (typeof numStr !== 'string' || numStr === '') return numStr;
  if (/e/i.test(numStr)) return numStr;

  const isNegative = numStr.startsWith('-');
  const unsigned = isNegative ? numStr.slice(1) : numStr;
  const dotIdx = unsigned.indexOf('.');
  const intPart = dotIdx === -1 ? unsigned : unsigned.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : unsigned.slice(dotIdx);

  // Strip leading zeros from the integer part; keep at least one digit.
  const stripped = intPart.replace(/^0+/, '') || '0';

  return `${isNegative ? '-' : ''}${stripped}${fracPart}`;
}

/**
 * Inserts thousands-separator commas into the integer portion of a
 * decimal number string (optionally signed). Exponential notation
 * (containing 'e'/'E') is left untouched, since grouping digits in
 * scientific notation isn't meaningful.
 * @param {string} numStr
 * @returns {string}
 */
export function addThousandsSeparators(numStr) {
  if (typeof numStr !== 'string' || numStr === '') return numStr;
  if (/e/i.test(numStr)) return numStr;

  const isNegative = numStr.startsWith('-');
  const unsigned = isNegative ? numStr.slice(1) : numStr;
  const [intPart, ...rest] = unsigned.split('.');

  if (intPart === '') return numStr; // e.g. a lone "-" or ".5" mid-entry

  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimalPart = rest.length ? `.${rest.join('.')}` : '';

  return `${isNegative ? '-' : ''}${grouped}${decimalPart}`;
}

/**
 * Adds thousands separators to every number substring inside a mixed
 * expression string, leaving operators, parentheses, and superscript
 * exponent characters untouched.
 * @param {string} text
 * @returns {string}
 */
export function formatExpressionWithCommas(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/-?\d+(?:\.\d+)?/g, (match) => addThousandsSeparators(match));
}
