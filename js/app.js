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
import { tokensToPlainText } from './formatUtils.js';
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

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback for context without permissions
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(success);
  } catch {
    return false;
  }
}

function main() {
  const state = new CalculatorState();
  const history = new HistoryManager();

  // Prevent iOS Safari overscroll rubber-banding except on scrollable elements (history list)
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.target.closest('.history-list')) {
        return;
      }
      event.preventDefault();
    },
    { passive: false }
  );

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

  const controller = new InputController({
    state,
    onChange: () => render(),
    onEvaluate: (tokens) => {
      const expressionText = tokensToPlainText(tokens);
      history.add(tokens, expressionText, state.resultString);
      renderHistory(history.getAll(), handleHistorySelect);
    },
  });

  function handleHistorySelect(id) {
    const entry = history.findById(id);
    if (!entry) return;
    if (Array.isArray(entry.tokens) && entry.tokens.length > 0) {
      state.loadFromHistory(entry.tokens, entry.result);
    } else {
      state.clearAll();
      state.tokens = state._tokensFromString(entry.result);
      state.displayState = DisplayState.ENTRY;
    }
    render();
    toggleHistoryPanel(false);
  }

  const keypadEl = document.getElementById('keypad');
  controller.attachKeypad(keypadEl);
  controller.attachKeyboard(window);

  const upperDisplayEl = document.getElementById('upper-display');
  upperDisplayEl.addEventListener('click', () => {
    state.recallExpressionToEntry();
    render();
  });

  // Tap lower display to open Copy / Paste context menu
  const lowerDisplayEl = document.getElementById('lower-display');
  const clipboardMenu = document.getElementById('clipboard-menu');

  lowerDisplayEl.addEventListener('click', () => {
    showClipboardMenu();
  });

  if (clipboardMenu) {
    clipboardMenu.addEventListener('click', async (event) => {
      const item = event.target.closest('[data-clipboard]');
      if (!item) return;

      const action = item.dataset.clipboard;
      hideClipboardMenu();

      if (action === 'copy') {
        const textToCopy = lowerDisplayEl.textContent ? lowerDisplayEl.textContent.trim() : '';
        if (!textToCopy) return;
        const copied = await copyToClipboard(textToCopy);
        if (copied) {
          showToast('Copied');
        }
      } else if (action === 'paste') {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (state.pasteExpression(text)) {
              render();
              showToast('Pasted');
            } else {
              showToast('Nothing to paste');
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
  const confirmDialog = document.getElementById('confirm-dialog');
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.getElementById('history-panel').classList.contains('is-open')) {
        toggleHistoryPanel(false);
      }
      hideClipboardMenu();
    }
  });

  registerServiceWorker();
  setupInstallPrompt(document.getElementById('install-btn'));
  setupForceUpdate(document.getElementById('version-badge'));

  // Re-render on orientation or window size change so font sizes recalculate immediately
  const orientationMq = window.matchMedia('(orientation: landscape)');
  if (orientationMq.addEventListener) {
    orientationMq.addEventListener('change', () => render());
  } else if (orientationMq.addListener) {
    orientationMq.addListener(() => render());
  }
  window.addEventListener('resize', () => render());
  window.addEventListener('orientationchange', () => {
    render();
    setTimeout(render, 60);
  });

  render();
}

document.addEventListener('DOMContentLoaded', main);
