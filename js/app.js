/**
 * app.js
 *
 * Composition root. Instantiates the state, history manager, and
 * input controller, wires them to the UI renderer, and boots the PWA
 * service worker. No business logic lives here — this file only
 * connects modules together.
 */

import { CalculatorState } from './calculatorState.js';
import { HistoryManager } from './historyManager.js';
import { InputController } from './inputController.js';
import { tokensToPlainText } from './formatUtils.js';
import {
  renderDisplay,
  setCloseParenEnabled,
  renderHistory,
  toggleHistoryPanel,
  flashButton,
  showCopyToast,
} from './uiRenderer.js';
import { registerServiceWorker, setupInstallPrompt } from './pwaBootstrap.js';

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
      for (const ch of entry.result) {
        if (ch === '-') state.toggleSign();
        else if (ch === '.') state.inputDecimal();
        else state.inputDigit(ch);
      }
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

  // Tap lower display to copy current displayed text to iOS/browser clipboard
  const lowerDisplayEl = document.getElementById('lower-display');
  lowerDisplayEl.addEventListener('click', async () => {
    const textToCopy = lowerDisplayEl.textContent ? lowerDisplayEl.textContent.trim() : '';
    if (!textToCopy) return;

    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        success = true;
      }
    } catch {
      // Fallback for context without permissions
    }

    if (!success) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        success = false;
      }
    }

    if (success) {
      showCopyToast();
    }
  });

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
    if (event.key === 'Escape' && document.getElementById('history-panel').classList.contains('is-open')) {
      toggleHistoryPanel(false);
    }
  });

  registerServiceWorker();
  setupInstallPrompt(document.getElementById('install-btn'));

  render();
}

document.addEventListener('DOMContentLoaded', main);
