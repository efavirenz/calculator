/**
 * uiRenderer.js
 *
 * All DOM manipulation lives here. This module receives plain data
 * (token arrays, strings, booleans) from calculatorState / app.js and
 * turns it into DOM updates. It never mutates calculator state itself.
 */

import { addThousandsSeparators, formatExpressionWithCommas } from './formatUtils.js';

const SELECTORS = {
  upperDisplay: '#upper-display',
  lowerDisplay: '#lower-display',
  keypad: '#keypad',
  closeParenButton: '[data-action="paren-close"]',
  historyPanel: '#history-panel',
  historyList: '#history-list',
  historyOverlay: '#history-overlay',
};

/**
 * Renders a token array into a document fragment, wrapping contiguous
 * isExponent runs in <sup> elements and skipping hidden tokens.
 * @param {Array<object>} tokens
 * @returns {DocumentFragment}
 */
function renderTokensToFragment(tokens) {
  const fragment = document.createDocumentFragment();
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.hidden) {
      i += 1;
      continue;
    }

    if (token.isExponent) {
      const sup = document.createElement('sup');
      sup.className = 'exponent';
      let text = '';
      while (i < tokens.length && tokens[i].isExponent) {
        if (!tokens[i].hidden) text += tokens[i].char;
        i += 1;
      }
      sup.textContent = text;
      fragment.appendChild(sup);
      continue;
    }

    if (token.kind === 'digit' || token.kind === 'decimal') {
      // Group a contiguous run of digit/decimal tokens (a single
      // number) so thousands separators can be inserted for values
      // of 1000 and above.
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
      const textNode = document.createTextNode(addThousandsSeparators(numStr));
      fragment.appendChild(textNode);
      continue;
    }

    const textNode = document.createTextNode(displayChar(token.char));
    fragment.appendChild(textNode);
    i += 1;
  }

  return fragment;
}

/** Maps internal operator characters to their display glyphs. */
function displayChar(char) {
  return char;
}

/**
 * Renders the two-line display per the State A / State B rules.
 * @param {object} params
 * @param {'A'|'B'} params.displayState
 * @param {Array<object>} params.tokens - expression tokens
 * @param {string|null} params.resultString
 * @param {string|null} params.errorMessage
 */
export function renderDisplay({ displayState, tokens, resultString, errorMessage }) {
  const upperEl = document.querySelector(SELECTORS.upperDisplay);
  const lowerEl = document.querySelector(SELECTORS.lowerDisplay);

  upperEl.textContent = '';
  upperEl.style.fontSize = '';

  lowerEl.textContent = '';
  lowerEl.style.fontSize = '';

  if (errorMessage) {
    upperEl.appendChild(renderTokensToFragment(tokens));
    lowerEl.textContent = 'Error';
    lowerEl.classList.add('is-error');
    autoShrinkToFit(lowerEl);
    autoShrinkToFit(upperEl);
    return;
  }

  lowerEl.classList.remove('is-error');

  if (displayState === 'B') {
    upperEl.appendChild(renderTokensToFragment(tokens));
    lowerEl.textContent = resultString !== null ? addThousandsSeparators(resultString) : '';
  } else {
    // State A: upper stays empty; lower shows the live expression.
    lowerEl.appendChild(renderTokensToFragment(tokens.length ? tokens : [{ char: '0', kind: 'digit', isExponent: false, hidden: false }]));
  }

  autoShrinkToFit(lowerEl);
  autoShrinkToFit(upperEl);
}

/** Shrinks font-size on the display line if the content overflows its box. */
function autoShrinkToFit(el) {
  const maxFontPx = parseFloat(getComputedStyle(el).getPropertyValue('--display-max-font'));
  const minFontPx = parseFloat(getComputedStyle(el).getPropertyValue('--display-min-font'));
  el.style.fontSize = `${maxFontPx}px`;

  let currentSize = maxFontPx;
  while (el.scrollWidth > el.clientWidth && currentSize > minFontPx) {
    currentSize -= 1;
    el.style.fontSize = `${currentSize}px`;
  }
}

/**
 * Enables/disables the ')' button based on paren balance.
 * @param {boolean} enabled
 */
export function setCloseParenEnabled(enabled) {
  const btn = document.querySelector(SELECTORS.closeParenButton);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
}

/**
 * Renders the history list.
 * @param {Array<{id:string, timestamp:number, expression:string, result:string}>} entries
 * @param {(id:string)=>void} onSelect - callback when an entry is tapped
 */
export function renderHistory(entries, onSelect) {
  const listEl = document.querySelector(SELECTORS.historyList);
  listEl.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = 'No calculations yet';
    listEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = 'history-item';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    const exprEl = document.createElement('div');
    exprEl.className = 'history-expression';
    exprEl.textContent = formatExpressionWithCommas(entry.expression);

    const resultEl = document.createElement('div');
    resultEl.className = 'history-result';
    resultEl.textContent = `= ${addThousandsSeparators(entry.result)}`;

    const timeEl = document.createElement('div');
    timeEl.className = 'history-timestamp';
    timeEl.textContent = formatTimestamp(entry.timestamp);

    item.append(exprEl, resultEl, timeEl);
    item.addEventListener('click', () => onSelect(entry.id));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(entry.id);
      }
    });

    listEl.appendChild(item);
  }
}

function formatTimestamp(ms) {
  const date = new Date(ms);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function toggleHistoryPanel(open) {
  const panel = document.querySelector(SELECTORS.historyPanel);
  const overlay = document.querySelector(SELECTORS.historyOverlay);
  panel.classList.toggle('is-open', open);
  overlay.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', String(!open));
  if (open) {
    panel.querySelector('.history-close')?.focus();
  }
}

/**
 * Applies a brief "flash" animation to a button for tactile feedback.
 * @param {HTMLElement} buttonEl
 */
export function flashButton(buttonEl) {
  if (!buttonEl) return;
  buttonEl.classList.add('is-active');
  window.setTimeout(() => buttonEl.classList.remove('is-active'), 150);
}

export { SELECTORS };
