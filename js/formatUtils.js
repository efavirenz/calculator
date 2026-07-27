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
 * @param {Array<{char:string, isExponent:boolean, hidden:boolean}>} tokens
 * @returns {string}
 */
export function tokensToPlainText(tokens) {
  let out = '';
  for (const token of tokens) {
    if (token.hidden) continue;
    if (token.isExponent) {
      out += SUPERSCRIPT_MAP[token.char] ?? token.char;
    } else {
      out += token.char;
    }
  }
  return out;
}
