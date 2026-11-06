import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalculatorState } from '../js/calculatorState.js';
import { InputController } from '../js/inputController.js';

test('Escape dismisses a transient panel before it can clear calculator state', () => {
  const state = new CalculatorState(); state.inputDigit('4');
  let historyOpen = true; let prevented = false; let stopped = false;
  const target = { addEventListener: (_type, callback) => { target.handler = callback; } };
  const controller = new InputController({
    state, isHistoryOpen: () => historyOpen,
    handleEscape: () => { if (!historyOpen) return false; historyOpen = false; return true; },
  });
  controller.attachKeyboard(target);
  target.handler({ key: 'Escape', target: { closest: () => null }, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }, metaKey: false, ctrlKey: false, altKey: false });
  assert.equal(historyOpen, false); assert.equal(state.rawExpression, '4');
  assert.equal(prevented, true); assert.equal(stopped, true);
});

test('Escape retains clear-key behavior when no transient UI is open', () => {
  const state = new CalculatorState(); state.inputDigit('4');
  const target = { addEventListener: (_type, callback) => { target.handler = callback; } };
  const controller = new InputController({ state }); controller.attachKeyboard(target);
  target.handler({ key: 'Escape', target: { closest: () => null }, preventDefault: () => {}, stopPropagation: () => {}, metaKey: false, ctrlKey: false, altKey: false });
  assert.equal(state.isEmpty, true);
});
