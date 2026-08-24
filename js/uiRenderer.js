/**
 * uiRenderer.js
 *
 * All DOM manipulation lives here. This module receives plain data
 * (token arrays, strings, booleans) from calculatorState / app.js and
 * turns it into DOM updates. It never mutates calculator state itself.
 */

import { addThousandsSeparators, formatExpressionWithCommas, stripLeadingZeros } from './formatUtils.js';

const SELECTORS = {
  upperDisplay: '#upper-display',
  lowerDisplay: '#lower-display',
  keypad: '#keypad',
  closeParenButton: '[data-action="paren-close"]',
  reciprocalButton: '[data-action="reciprocal"]',
  signButton: '[data-action="sign"]',
  powerButton: '[data-action="power"]',
  historyPanel: '#history-panel',
  historyList: '#history-list',
  historyOverlay: '#history-overlay',
  clipboardMenu: '#clipboard-menu',
  copyToast: '#copy-toast',
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
      // Strip leading zeros before applying thousands separators so that
      // e.g. "001" renders as "1" and "0,001" (comma-as-thousands) renders
      // as "0.001" → still correct because stripping only touches the
      // integer part ("0" stays "0" before a decimal point).
      const textNode = document.createTextNode(addThousandsSeparators(stripLeadingZeros(numStr)));
      fragment.appendChild(textNode);
      continue;
    }

    const textNode = document.createTextNode(token.char);
    fragment.appendChild(textNode);
    i += 1;
  }

  return fragment;
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
  upperEl.style.visibility = '';

  lowerEl.textContent = '';
  lowerEl.style.fontSize = '';

  if (errorMessage) {
    upperEl.style.display = '';
    upperEl.style.visibility = '';
    upperEl.appendChild(renderTokensToFragment(tokens));
    lowerEl.textContent = errorMessage;
    lowerEl.classList.add('is-error');
    autoShrinkToFit(lowerEl);
    autoShrinkToFit(upperEl);
    return;
  }

  lowerEl.classList.remove('is-error');

  if (displayState === 'B') {
    upperEl.style.display = '';
    upperEl.style.visibility = '';
    upperEl.appendChild(renderTokensToFragment(tokens));
    lowerEl.textContent = resultString !== null ? addThousandsSeparators(resultString) : '';
  } else {
    const isLandscape = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(orientation: landscape) and (max-height: 550px)').matches;
    if (isLandscape) {
      upperEl.style.display = '';
      upperEl.style.visibility = 'hidden';
      upperEl.textContent = '\u00A0';
    } else {
      // State A in portrait: hide upper display completely (forces iOS WebKit GPU layer flush); lower shows live expression.
      upperEl.style.display = 'none';
      upperEl.style.visibility = '';
    }
    lowerEl.appendChild(renderTokensToFragment(tokens.length ? tokens : [{ char: '0', kind: 'digit', isExponent: false, hidden: false }]));
  }

  autoShrinkToFit(lowerEl);
  if (displayState === 'B') {
    autoShrinkToFit(upperEl);
  }
}

/** Shrinks font-size on the display line if the content overflows its box. */
function autoShrinkToFit(el) {
  const upperEl = document.querySelector(SELECTORS.upperDisplay);
  const isUpper = el === upperEl;
  const maxFontPx = parseFloat(getComputedStyle(el).getPropertyValue('--display-max-font')) || (isUpper ? 34 : 64);
  const minFontPx = parseFloat(getComputedStyle(el).getPropertyValue('--display-min-font')) || (isUpper ? 18 : 26);
  el.style.fontSize = `${maxFontPx}px`;

  if (el.scrollWidth > el.clientWidth) {
    const ratio = el.clientWidth / el.scrollWidth;
    const targetSize = Math.max(minFontPx, Math.floor(maxFontPx * ratio));
    el.style.fontSize = `${targetSize}px`;
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
 * Enables/disables the '1/x' button based on operand availability.
 * @param {boolean} enabled
 */
export function setReciprocalButtonState(enabled) {
  const btn = document.querySelector(SELECTORS.reciprocalButton);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
}

/**
 * Enables/disables the '+/-' button based on operand availability.
 * @param {boolean} enabled
 */
export function setSignButtonState(enabled) {
  const btn = document.querySelector(SELECTORS.signButton);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
}

/**
 * Updates the disabled state and active dark-blue styling of the xʸ button.
 * @param {boolean} enabled
 * @param {boolean} active
 */
export function setPowerButtonState(enabled, active) {
  const btn = document.querySelector(SELECTORS.powerButton);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
  btn.classList.toggle('is-exponent-active', Boolean(active));
}

/**
 * Renders the history list.
 * @param {Array<{id:string, timestamp:number, expression:string, result:string}>} entries
 * @param {(id:string)=>void} onSelect - callback when an entry is tapped
 */
export function renderHistory(entries, onSelect) {
  const listEl = document.querySelector(SELECTORS.historyList);
  listEl.replaceChildren();

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

let toastTimeout = null;

/**
 * Shows temporary floating notification toast.
 * @param {string} [message='Copied']
 */
export function showToast(message = 'Copied') {
  const toast = document.querySelector(SELECTORS.copyToast);
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 1500);
}

/** Shows temporary 'Copied' floating notification toast. (Alias for showToast) */
export function showCopyToast() {
  showToast('Copied');
}

let menuDismissHandler = null;

/** Shows the clipboard context menu. */
export function showClipboardMenu() {
  const menu = document.querySelector(SELECTORS.clipboardMenu);
  if (!menu) return;

  menu.removeAttribute('hidden');
  void menu.offsetWidth; // force reflow for transition
  menu.classList.add('is-visible');

  if (menuDismissHandler) {
    document.removeEventListener('pointerdown', menuDismissHandler);
  }
  menuDismissHandler = (event) => {
    if (!menu.contains(event.target)) {
      hideClipboardMenu();
    }
  };
  // Delay attachment so the click opening the menu does not immediately dismiss it
  setTimeout(() => {
    document.addEventListener('pointerdown', menuDismissHandler);
  }, 0);
}

/** Hides the clipboard context menu. */
export function hideClipboardMenu() {
  const menu = document.querySelector(SELECTORS.clipboardMenu);
  if (!menu) return;

  menu.classList.remove('is-visible');
  setTimeout(() => {
    if (!menu.classList.contains('is-visible')) {
      menu.setAttribute('hidden', '');
    }
  }, 150);

  if (menuDismissHandler) {
    document.removeEventListener('pointerdown', menuDismissHandler);
    menuDismissHandler = null;
  }
}

export { SELECTORS };

