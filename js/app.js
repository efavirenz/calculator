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
} from './uiRenderer.js';
import { registerServiceWorker, setupInstallPrompt } from './pwaBootstrap.js';

function main() {
  const state = new CalculatorState();
  const history = new HistoryManager();

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
    // Restore the tapped entry exactly as it looked right after it was
    // calculated: expression on the upper line, result on the lower
    // line. From there, tapping the upper line or pressing Backspace
    // resumes editing it (see recallExpressionToEntry / backspace()).
    if (Array.isArray(entry.tokens) && entry.tokens.length > 0) {
      state.loadFromHistory(entry.tokens, entry.result);
    } else {
      // Backward compatibility for history entries saved before tokens
      // were persisted: fall back to re-entering the result as fresh
      // input.
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

  // Tapping the upper (expression) line moves it down into the
  // editable lower line, leaving the upper line empty, so the user
  // can resume editing the expression instead of starting fresh.
  const upperDisplayEl = document.getElementById('upper-display');
  upperDisplayEl.addEventListener('click', () => {
    state.recallExpressionToEntry();
    render();
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
