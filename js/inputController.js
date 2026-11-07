/**
 * inputController.js
 *
 * Translates raw user input (pointer and keyboard events) into
 * calls on CalculatorState, then asks the caller to re-render.
 * The composition root supplies transient UI state through callbacks; this
 * controller does not query global document state.
 */

const KEY_TO_ACTION = {
  Enter: 'equals',
  '=': 'equals',
  Escape: 'clear',
  c: 'clear',
  C: 'clear',
  Backspace: 'backspace',
  Delete: 'backspace',
  '+': 'op-add',
  '-': 'op-subtract',
  '*': 'op-multiply',
  x: 'op-multiply',
  X: 'op-multiply',
  '/': 'op-divide',
  '^': 'power',
  '(': 'paren-open',
  ')': 'paren-close',
  '.': 'decimal',
  r: 'reciprocal',
  R: 'reciprocal',
  F9: 'sign',
  _: 'sign',
  n: 'sign',
  N: 'sign',
};

for (let d = 0; d <= 9; d += 1) {
  KEY_TO_ACTION[String(d)] = `digit-${d}`;
}

/**
 * @property {import('./calculatorState.js').CalculatorState} state
 * @property {(action?: string) => void} onChange
 * @property {(tokens: Array<object>, result: string, before: string) => void} onEvaluate
 * @property {() => boolean} isDialogOpen
 * @property {() => boolean} isHistoryOpen
 * @property {() => boolean} handleEscape
 */
export class InputController {
  /**
   * @param {object} params
   * @param {import('./calculatorState.js').CalculatorState} params.state
   * @param {(action?: string) => void} params.onChange - called after every mutating action
   * @param {(tokens: Array<object>, result: string, before: string) => void} params.onEvaluate - called on successful '='
   * @param {() => boolean} [params.isDialogOpen]
   * @param {() => boolean} [params.isHistoryOpen]
   * @param {() => boolean} [params.handleEscape]
   */
  constructor({ state, onChange, onEvaluate, isDialogOpen = () => false, isHistoryOpen = () => false, handleEscape = () => false }) {
    /** @type {import('./calculatorState.js').CalculatorState} */
    this.state = state;
    /** @type {(action?: string) => void} */
    this.onChange = onChange;
    /** @type {(tokens: Array<object>, result: string, before: string) => void} */
    this.onEvaluate = onEvaluate;
    /** @type {() => boolean} */
    this.isDialogOpen = isDialogOpen;
    /** @type {() => boolean} */
    this.isHistoryOpen = isHistoryOpen;
    /** @type {() => boolean} */
    this.handleEscape = handleEscape;
  }

  /**
   * Dispatches a single logical action (from a button's data-action /
   * data-value attributes, or from a mapped keyboard key).
   * @param {string} action
   * @param {string|undefined} value
   */
  dispatch(action, value) {
    const { state } = this;

    switch (action) {
      case 'digit':
        state.inputDigit(value);
        break;
      case 'decimal':
        state.inputDecimal();
        break;
      case 'op-add':
        state.inputOperator('+');
        break;
      case 'op-subtract':
        state.inputOperator('-');
        break;
      case 'op-multiply':
        state.inputOperator('×');
        break;
      case 'op-divide':
        state.inputOperator('÷');
        break;
      case 'power':
        state.inputPower();
        break;
      case 'reciprocal':
        state.inputReciprocal();
        break;
      case 'sign':
        state.toggleSign();
        break;
      case 'paren-open':
        state.inputOpenParen();
        break;
      case 'paren-close':
        state.inputCloseParen();
        break;
      case 'backspace':
        state.backspace();
        break;
      case 'clear':
        state.clearAll();
        break;
      case 'equals': {
        const before = state.rawExpression;
        const outcome = state.evaluate();
        if (outcome && outcome.success && this.onEvaluate) {
          this.onEvaluate(outcome.expression, outcome.result, before);
        }
        break;
      }
      default:
        return; // unknown action: don't trigger a re-render
    }

    if (this.onChange) this.onChange(action);
  }

  /**
   * Attaches delegated pointer input plus a keyboard/assistive-click fallback.
   * Pointer actions run on pointerdown for immediate feedback. The click path
   * accepts only detail=0 activations (keyboard, assistive technology, or
   * programmatic clicks), so the pointer-generated click cannot dispatch twice.
   * No persistent pointer flag is kept, so a cancelled pointer cannot swallow
   * a later keyboard activation.
   * @param {HTMLElement} keypadEl
   */
  attachKeypad(keypadEl) {
    const activateButton = (button) => {
      if (!button || button.disabled) return;

      const { action, value } = button.dataset;
      if (action === 'digit') this.dispatch('digit', value);
      else this.dispatch(action);

      button.dispatchEvent(new CustomEvent('calc-pressed', { bubbles: true }));
    };

    keypadEl.addEventListener('pointerdown', (event) => {
      if (event.isPrimary === false) return;
      if (event.button !== undefined && event.button !== 0) return;

      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) return;

      // Process immediately; prevent the compatibility click/gesture default.
      event.preventDefault();

      // pointerdown cancellation also prevents the browser's normal focus step.
      // Restore focus explicitly without allowing the page to scroll.
      if (typeof button.focus === 'function') {
        try {
          button.focus({ preventScroll: true });
        } catch {
          button.focus();
        }
      }

      activateButton(button);
    });

    keypadEl.addEventListener('click', (event) => {
      // Pointer clicks are already handled at pointerdown. detail=0 preserves
      // Enter/Space, screen-reader, and programmatic button activation.
      if (event.detail !== 0) return;
      const button = event.target.closest('button[data-action]');
      activateButton(button);
    });
  }

  /** Attaches the global keyboard listener. */
  attachKeyboard(target = window) {
    target.addEventListener('keydown', (event) => {
      // Allow browser and OS shortcuts (Cmd+C, Ctrl+V, Cmd+R, Cmd+X, etc.)
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      // Ignore keystrokes while focus is inside a text input/dialog control.
      if (event.target && event.target.closest && event.target.closest('input, textarea, dialog')) return;
      if (this.isDialogOpen()) return;

      if (event.key === 'Escape' && this.handleEscape()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (this.isHistoryOpen()) return;

      const mapped = KEY_TO_ACTION[event.key];
      if (!mapped) return;

      event.preventDefault();

      if (mapped === 'paren-close' && this.state.parenBalance <= 0) {
        return; // respect the same disabled-state rule as the on-screen button
      }

      if (mapped === 'power' && !this.state.isPowerEnabled) {
        return; // respect the same disabled-state rule as the on-screen button
      }

      if (mapped === 'reciprocal' && !this.state.isReciprocalEnabled) {
        return; // respect the same disabled-state rule as the on-screen button
      }

      if (mapped === 'sign' && !this.state.isSignEnabled) {
        return; // respect the same disabled-state rule as the on-screen button
      }

      if (mapped.startsWith('digit-')) {
        this.dispatch('digit', mapped.slice('digit-'.length));
      } else {
        this.dispatch(mapped);
      }
    });
  }
}
