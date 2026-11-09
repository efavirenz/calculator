/**
 * app.js
 *
 * Composition root. Instantiates the state, history manager, and
 * input controller, wires them to the UI renderer, and boots the PWA
 * service worker. No business logic lives here — this file only
 * connects modules together.
 */

import { CalculatorState, DisplayState } from './calculatorState.js';
import { HistoryManager } from './historyManager.js';
import { InputController } from './inputController.js';
import { HISTORY_STORAGE_KEY } from './storageManager.js';
import { tokensToPlainText, tokensToClipboardText } from './formatUtils.js';
import {
  renderDisplay,
  setCloseParenEnabled,
  setPowerButtonState,
  setReciprocalButtonState,
  setSignButtonState,
  renderHistory,
  toggleHistoryPanel,
  flashButton,
  showToast,
  showClipboardMenu,
  hideClipboardMenu,
} from './uiRenderer.js';
import { registerServiceWorker, setupInstallPrompt, setupForceUpdate } from './pwaBootstrap.js';

const PASTE_ERROR_MESSAGES = {
  empty: 'Nothing to paste',
  invalid: 'Cannot paste expression',
  'too-long': 'Number is too long to paste',
  ambiguous: 'Ambiguous number format',
  rejected: 'Cannot combine with current expression',
};

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback for context without permissions
  }

  const textarea = document.createElement('textarea');
  try {
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return Boolean(document.execCommand('copy'));
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function main() {
  const state = new CalculatorState();
  const history = new HistoryManager();
  const confirmDialog = document.getElementById('confirm-dialog');
  const historyPanel = document.getElementById('history-panel');
  const clipboardMenu = document.getElementById('clipboard-menu');

  // The drawer starts closed; keep its controls out of the tab order and the
  // accessibility tree before the first toggle (AUD-007).
  if (historyPanel) historyPanel.inert = true;

  // Prevent iOS Safari overscroll rubber-banding except on scrollable
  // surfaces. Multi-touch (pinch-zoom) is never vetoed, and non-cancelable
  // events are left alone (AUD-005).
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!event.cancelable) return;
      if (event.touches && event.touches.length > 1) return;
      if (event.target?.closest?.('.history-list, .display-line, dialog')) {
        return;
      }
      event.preventDefault();
    },
    { passive: false }
  );

  function addSwipeSafeClickListener(el, onClick) {
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let didMove = false;

    el.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      didMove = false;
    });

    el.addEventListener('pointermove', (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
        didMove = true;
      }
    });

    el.addEventListener('pointercancel', () => {
      didMove = true;
    });

    el.addEventListener('click', (e) => {
      if (didMove) {
        didMove = false;
        return;
      }
      onClick(e);
    });
  }

  function render() {
    renderDisplay({
      displayState: state.displayState,
      tokens: state.getExpressionDisplayTokens(),
      resultString: state.resultString,
      errorMessage: state.errorMessage,
    });
    setCloseParenEnabled(state.parenBalance > 0);
    setPowerButtonState(state.isPowerEnabled, state.exponentMode);
    setReciprocalButtonState(state.isReciprocalEnabled);
    setSignButtonState(state.isSignEnabled);
  }

  function addKeyboardActivation(el, onActivate) {
    if (!el) return;
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onActivate();
    });
  }

  function isHistoryPanelOpen() {
    return Boolean(historyPanel?.classList.contains('is-open'));
  }

  let lastHistorySignature = null;

  const controller = new InputController({
    state,
    isDialogOpen: () => Boolean(confirmDialog?.open),
    isHistoryOpen: () => isHistoryPanelOpen(),
    handleEscape: () => {
      if (confirmDialog?.open) return false; // Native dialog owns its Escape behavior.
      if (isHistoryPanelOpen()) {
        toggleHistoryPanel(false);
        return true;
      }
      if (clipboardMenu && !clipboardMenu.hidden) {
        hideClipboardMenu({ restoreFocus: true });
        return true;
      }
      return false;
    },
    onChange: (action) => {
      // Any non-equals mutation invalidates the "same calculation" signature.
      if (action !== 'equals') lastHistorySignature = null;
      render();
    },
    onEvaluate: (tokens) => {
      const expressionText = tokensToPlainText(tokens);
      const signature = `${expressionText}|${state.resultString}`;
      if (signature !== lastHistorySignature) {
        history.add(tokens, expressionText, state.resultString);
        // Allow a retry when persistence failed and the entry was dropped.
        lastHistorySignature = history.lastSaveFailed ? null : signature;
        if (history.lastSaveWasTrimmed) showToast('Older history removed to free storage');
        else if (history.lastSaveFailed) showToast('History could not be saved; browser storage is full');
      }
      // The drawer already re-renders when opened, so only refresh it when visible.
      if (isHistoryPanelOpen()) renderHistory(history.getAll(), handleHistorySelect);
    },
  });

  function handleHistorySelect(id) {
    const entry = history.findById(id);
    if (!entry) return;
    if (Array.isArray(entry.tokens) && entry.tokens.length > 0) {
      state.loadFromHistory(entry.tokens, entry.result);
    } else {
      state.loadResultOnly(entry.result);
    }
    render();
    toggleHistoryPanel(false);
  }

  const keypadEl = document.getElementById('keypad');
  controller.attachKeypad(keypadEl);
  controller.attachKeyboard(window);

  const upperDisplayEl = document.getElementById('upper-display');
  addSwipeSafeClickListener(upperDisplayEl, () => {
    state.recallExpressionToEntry();
    render();
  });
  addKeyboardActivation(upperDisplayEl, () => {
    state.recallExpressionToEntry();
    render();
  });

  // Tap lower display to open Copy / Paste context menu
  const lowerDisplayEl = document.getElementById('lower-display');
  addSwipeSafeClickListener(lowerDisplayEl, () => {
    showClipboardMenu();
  });
  addKeyboardActivation(lowerDisplayEl, () => {
    showClipboardMenu();
  });

  if (clipboardMenu) {
    clipboardMenu.addEventListener('click', async (event) => {
      const item = event.target.closest('[data-clipboard]');
      if (!item) return;

      const action = item.dataset.clipboard;
      hideClipboardMenu({ restoreFocus: true });

      if (action === 'copy') {
        let textToCopy = '';
        if (state.displayState === DisplayState.RESULT && state.resultString !== null) {
          textToCopy = state.resultString;
        } else if (state.tokens.length > 0) {
          textToCopy = tokensToClipboardText(state.tokens);
        } else {
          textToCopy = '0';
        }
        if (!textToCopy) return;
        const copied = await copyToClipboard(textToCopy);
        if (copied) {
          showToast('Copied');
        }
      } else if (action === 'paste') {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            const outcome = state.pasteExpressionWithReason(text);
            if (outcome.success) {
              render();
              showToast('Pasted');
            } else {
              showToast(PASTE_ERROR_MESSAGES[outcome.reason] || 'Nothing to paste');
            }
          } else {
            showToast('Paste not supported');
          }
        } catch {
          showToast('Paste permission denied');
        }
      }
    });
  }

  // Button press flash feedback (delegated).
  keypadEl.addEventListener('calc-pressed', (event) => {
    flashButton(event.target.closest('button'));
  });

  // History panel wiring.
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const historyCloseBtn = document.querySelector('.history-close');
  const historyOverlay = document.getElementById('history-overlay');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const confirmYesBtn = document.getElementById('confirm-yes');
  const confirmNoBtn = document.getElementById('confirm-no');

  hamburgerBtn.addEventListener('click', () => {
    renderHistory(history.getAll(), handleHistorySelect);
    toggleHistoryPanel(true);
  });
  historyCloseBtn.addEventListener('click', () => toggleHistoryPanel(false));
  historyOverlay.addEventListener('click', () => toggleHistoryPanel(false));

  clearHistoryBtn.addEventListener('click', () => {
    confirmDialog.showModal ? confirmDialog.showModal() : confirmDialog.setAttribute('open', '');
  });
  confirmYesBtn.addEventListener('click', () => {
    history.clear();
    renderHistory(history.getAll(), handleHistorySelect);
    confirmDialog.close ? confirmDialog.close() : confirmDialog.removeAttribute('open');
    toggleHistoryPanel(false);
  });
  confirmNoBtn.addEventListener('click', () => {
    confirmDialog.close ? confirmDialog.close() : confirmDialog.removeAttribute('open');
  });

  // Cross-tab reconciliation (NEW-006): another tab wrote the shared history
  // key, so re-read the validated list instead of overwriting its entries on
  // the next save.
  window.addEventListener('storage', (event) => {
    if (event.key !== HISTORY_STORAGE_KEY) return;
    history.reload();
    if (isHistoryPanelOpen()) renderHistory(history.getAll(), handleHistorySelect);
  });

  registerServiceWorker();
  setupInstallPrompt(document.getElementById('install-btn'));
  setupForceUpdate(document.getElementById('version-badge'));

  // Re-render on orientation or window size change so font sizes recalculate
  // immediately. Coalesce bursts (resize drags) into one frame (NEW-003).
  let resizeFrame = null;
  const scheduleRender = () => {
    if (resizeFrame !== null) return;
    const requestFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => window.setTimeout(callback, 16);
    resizeFrame = requestFrame(() => {
      resizeFrame = null;
      render();
    });
  };

  const orientationMq = window.matchMedia('(orientation: landscape)');
  if (orientationMq.addEventListener) {
    orientationMq.addEventListener('change', scheduleRender);
  } else if (orientationMq.addListener) {
    orientationMq.addListener(scheduleRender);
  }
  window.addEventListener('resize', scheduleRender);
  window.addEventListener('orientationchange', scheduleRender);

  render();
}

document.addEventListener('DOMContentLoaded', main);
