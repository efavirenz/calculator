/**
 * inputController.js
 *
 * Translates raw user input (button clicks, keyboard events) into
 * calls on CalculatorState, then asks the caller to re-render.
 * This is the only module that attaches DOM event listeners for
 * calculator input.
 */

const KEY_TO_ACTION = {
  Enter: 'equals',
  '=': 'equals',
  Escape: 'clear',
  Backspace: 'backspace',
  Delete: 'backspace',
  '+': 'op-add',
  '-': 'op-subtract',
  '*': 'op-multiply',
  '/': 'op-divide',
  '^': 'power',
  '(': 'paren-open',
  ')': 'paren-close',
  '.': 'decimal',
};

for (let d = 0; d <= 9; d += 1) {
  KEY_TO_ACTION[String(d)] = `digit-${d}`;
}

export class InputController {
  /**
   * @param {object} params
   * @param {import('./calculatorState.js').CalculatorState} params.state
   * @param {() => void} params.onChange - called after every mutating action
   * @param {(expression:string, result:string) => void} params.onEvaluate - called on successful '='
   */
  constructor({ state, onChange, onEvaluate }) {
    this.state = state;
    this.onChange = onChange;
    this.onEvaluate = onEvaluate;
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
   * Attaches a single delegated click listener to the keypad container.
   * @param {HTMLElement} keypadEl
   */
  attachKeypad(keypadEl) {
    keypadEl.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled) return;

      const action = button.dataset.action;
      const value = button.dataset.value;

      if (action === 'digit') {
        this.dispatch('digit', value);
      } else {
        this.dispatch(action);
      }

      button.dispatchEvent(new CustomEvent('calc-pressed', { bubbles: true }));
    });
  }

  /** Attaches the global keyboard listener. */
  attachKeyboard(target = window) {
    target.addEventListener('keydown', (event) => {
      // Ignore keystrokes while focus is inside a text input/dialog control.
      if (event.target && event.target.closest && event.target.closest('input, textarea')) {
        return;
      }

      const mapped = KEY_TO_ACTION[event.key];
      if (!mapped) return;

      event.preventDefault();

      if (mapped === 'paren-close' && this.state.parenBalance <= 0) {
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
