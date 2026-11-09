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
  if (!upperEl || !lowerEl) return;

  upperEl.textContent = '';
  upperEl.style.fontSize = '';
  upperEl.style.visibility = '';

  lowerEl.textContent = '';
  lowerEl.style.fontSize = '';
  lowerEl.classList.toggle('is-error', Boolean(errorMessage));

  const shrinkEls = [];
  const scrollEls = [];

  if (errorMessage) {
    upperEl.style.display = '';
    upperEl.style.visibility = '';
    upperEl.appendChild(renderTokensToFragment(tokens));
    lowerEl.textContent = errorMessage;
    shrinkEls.push(lowerEl, upperEl);
    scrollEls.push(upperEl, lowerEl);
  } else if (displayState === 'B') {
    upperEl.style.display = '';
    upperEl.style.visibility = '';
    upperEl.appendChild(renderTokensToFragment(tokens));
    lowerEl.textContent = resultString !== null ? addThousandsSeparators(resultString) : '';
    shrinkEls.push(lowerEl, upperEl);
    scrollEls.push(lowerEl, upperEl);
  } else {
    const isLandscape = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(orientation: landscape)').matches;
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
    shrinkEls.push(lowerEl);
    scrollEls.push(lowerEl);
  }

  // Batch the render phases: all writes above, then one measurement pass,
  // then one write pass. This avoids interleaving layout reads with writes
  // (NEW-003).
  applyAutoShrink(shrinkEls);
  scrollToDisplayEnd(scrollEls);
}

/**
 * Scrolls one or more display lines horizontally to their end so the most
 * recent input is visible. Reads are batched before writes.
 * @param {HTMLElement|Array<HTMLElement>|null} elOrEls
 */
export function scrollToDisplayEnd(elOrEls) {
  const els = (Array.isArray(elOrEls) ? elOrEls : [elOrEls]).filter(Boolean);
  if (els.length === 0) return;

  const widths = els.map((el) => el.scrollWidth);
  els.forEach((el, i) => {
    el.scrollLeft = widths[i];
  });

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      const latestWidths = els.map((el) => el.scrollWidth);
      els.forEach((el, i) => {
        el.scrollLeft = latestWidths[i];
      });
    });
  }
}

const fontLimitCache = new Map();

/**
 * Reads the display line's min/max font custom properties. Cached per
 * element/orientation/height class so repeated keystrokes do not re-read
 * computed styles.
 * @param {HTMLElement} el
 * @returns {{max: number, min: number}}
 */
function getFontLimits(el) {
  const isUpper = el.id === 'upper-display';
  let key = isUpper ? 'upper' : 'lower';
  if (typeof window !== 'undefined' && window.matchMedia) {
    key += window.matchMedia('(orientation: landscape)').matches ? '|landscape' : '|portrait';
    key += window.matchMedia('(max-height: 640px)').matches ? '|short' : '|tall';
  }
  let limits = fontLimitCache.get(key);
  if (!limits) {
    const styles = getComputedStyle(el);
    limits = {
      max: parseFloat(styles.getPropertyValue('--display-max-font')) || (isUpper ? 34 : 64),
      min: parseFloat(styles.getPropertyValue('--display-min-font')) || (isUpper ? 18 : 26),
    };
    fontLimitCache.set(key, limits);
  }
  return limits;
}

/**
 * Shrinks font-size on display lines that overflow. All candidate elements are
 * set to max size first, then measured together, then resized together.
 * @param {Array<HTMLElement>} els
 */
function applyAutoShrink(els) {
  const targets = els.filter(Boolean);
  if (targets.length === 0) return;

  const limits = targets.map((el) => getFontLimits(el));
  targets.forEach((el, i) => {
    el.style.fontSize = `${limits[i].max}px`;
  });

  const sizes = targets.map((el, i) => {
    const clientWidth = el.clientWidth;
    const scrollWidth = el.scrollWidth;
    if (!clientWidth || scrollWidth <= clientWidth) return limits[i].max;
    return Math.max(limits[i].min, Math.floor(limits[i].max * (clientWidth / scrollWidth)));
  });

  targets.forEach((el, i) => {
    el.style.fontSize = `${sizes[i]}px`;
  });
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
  if (!listEl) return;

  const fragment = document.createDocumentFragment();

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = 'No calculations yet';
    fragment.appendChild(empty);
  } else {
    for (const entry of entries) {
      const item = document.createElement('li');
      item.className = 'history-item';
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const exprEl = document.createElement('div');
      exprEl.className = 'history-expression';
      if (Array.isArray(entry.tokens) && entry.tokens.length > 0) {
        exprEl.appendChild(renderTokensToFragment(entry.tokens));
      } else {
        exprEl.textContent = formatExpressionWithCommas(entry.expression);
      }

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

      fragment.appendChild(item);
    }
  }

  listEl.replaceChildren(fragment);
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
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const appEl = document.getElementById('app');
  const wasOpen = panel ? panel.classList.contains('is-open') : false;

  if (panel) {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    // `inert` removes off-screen descendants from the tab order and the
    // accessibility tree while retaining the slide animation (AUD-007).
    panel.inert = !open;
  }
  if (overlay) {
    // Decorative click-to-close surface; its interactive state follows the
    // drawer. It is intentionally not aria-hidden (NEW-005).
    overlay.classList.toggle('is-open', open);
  }
  if (appEl) {
    // While the drawer is open, make the background non-interactive and
    // non-focusable so focus stays inside the drawer.
    appEl.inert = Boolean(open);
  }
  if (hamburgerBtn) {
    hamburgerBtn.setAttribute('aria-expanded', String(open));
  }
  if (open && panel) {
    panel.querySelector('.history-close')?.focus();
  } else if (!open && wasOpen && hamburgerBtn) {
    hamburgerBtn.focus();
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

let menuDismissHandler = null;

/** Shows the clipboard context menu and moves focus into it. */
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

  menu.querySelector('.clipboard-menu-item')?.focus();
}

/**
 * Hides the clipboard context menu.
 * @param {object} [options]
 * @param {boolean} [options.restoreFocus=false] - return focus to the lower
 *   display line (keyboard/Escape/menu-action dismissal paths).
 */
export function hideClipboardMenu({ restoreFocus = false } = {}) {
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

  if (restoreFocus) {
    document.querySelector(SELECTORS.lowerDisplay)?.focus();
  }
}

