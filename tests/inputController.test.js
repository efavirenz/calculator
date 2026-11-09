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

function createKeypadHarness(state) {
  const listeners = {};
  const pressedEvents = [];
  const classes = new Set();
  const button = {
    disabled: false,
    dataset: { action: 'digit', value: '7' },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    focus() {},
    dispatchEvent(event) { pressedEvents.push(event.type); return true; },
  };
  const target = { closest: () => button };
  const keypad = { addEventListener(type, handler) { listeners[type] = handler; } };
  new InputController({ state }).attachKeypad(keypad);
  return { listeners, button, target, pressedEvents, classes };
}

test('keypad pointerdown dispatches immediately and ignores its follow-up pointer click', () => {
  const state = new CalculatorState();
  const harness = createKeypadHarness(state);
  let prevented = false;

  harness.listeners.pointerdown({
    target: harness.target,
    isPrimary: true,
    button: 0,
    preventDefault() { prevented = true; },
  });
  harness.listeners.click({ target: harness.target, detail: 1 });

  assert.equal(prevented, true);
  assert.equal(state.rawExpression, '7');
  assert.deepEqual(harness.pressedEvents, ['calc-pressed']);
});

test('pointer focus styling clears when keyboard interaction resumes or focus leaves', () => {
  const state = new CalculatorState();
  const harness = createKeypadHarness(state);
  const tap = () => harness.listeners.pointerdown({
    target: harness.target,
    isPrimary: true,
    button: 0,
    preventDefault() {},
  });

  tap();
  assert.equal(harness.classes.has('pointer-focused'), true);
  harness.listeners.keydown({ target: harness.target });
  assert.equal(harness.classes.has('pointer-focused'), false);

  tap();
  assert.equal(harness.classes.has('pointer-focused'), true);
  harness.listeners.focusout({ target: harness.target });
  assert.equal(harness.classes.has('pointer-focused'), false);
});

test('rapid keypad pointerdown events are all accepted without debounce', () => {
  const state = new CalculatorState();
  const harness = createKeypadHarness(state);
  const tap = () => harness.listeners.pointerdown({
    target: harness.target,
    isPrimary: true,
    button: 0,
    preventDefault() {},
  });

  harness.button.dataset.value = '1';
  tap();
  harness.listeners.click({ target: harness.target, detail: 1 });
  harness.button.dataset.value = '2';
  tap();
  harness.listeners.click({ target: harness.target, detail: 1 });

  assert.equal(state.rawExpression, '12');
  assert.equal(harness.pressedEvents.length, 2);
});

test('keyboard-generated keypad click still works after pointer interaction', () => {
  const state = new CalculatorState();
  const harness = createKeypadHarness(state);

  harness.listeners.pointerdown({
    target: harness.target,
    isPrimary: true,
    button: 0,
    preventDefault() {},
  });
  harness.button.dataset.value = '4';
  harness.listeners.click({ target: harness.target, detail: 0 });

  assert.equal(state.rawExpression, '74');
  assert.equal(harness.pressedEvents.length, 2);
});

test('disabled and non-primary keypad pointer events do not dispatch', () => {
  const state = new CalculatorState();
  const harness = createKeypadHarness(state);

  harness.listeners.pointerdown({
    target: harness.target,
    isPrimary: false,
    button: 0,
    preventDefault() {},
  });
  harness.button.disabled = true;
  harness.listeners.pointerdown({
    target: harness.target,
    isPrimary: true,
    button: 0,
    preventDefault() {},
  });

  assert.equal(state.rawExpression, '');
  assert.deepEqual(harness.pressedEvents, []);
});

function dispatchKeyboard(state, key, { onButton = false } = {}) {
  const target = { addEventListener: (_type, callback) => { target.handler = callback; } };
  const changes = [];
  const controller = new InputController({ state, onChange: (action) => changes.push(action) });
  controller.attachKeyboard(target);
  let prevented = false;
  target.handler({
    key,
    target: {
      closest(selector) {
        return selector === 'button, [role="button"]' && onButton ? {} : null;
      },
    },
    preventDefault() { prevented = true; },
    stopPropagation() {},
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  });
  return { prevented, changes };
}

test('Enter on a focused button defers to native activation (AUD-006)', () => {
  const state = new CalculatorState();
  state.inputDigit('7');
  const { prevented, changes } = dispatchKeyboard(state, 'Enter', { onButton: true });
  assert.equal(prevented, false);
  assert.deepEqual(changes, []);
  assert.equal(state.rawExpression, '7');
});

test('Space on a focused button defers to native activation (AUD-006)', () => {
  const state = new CalculatorState();
  state.inputDigit('7');
  const { prevented, changes } = dispatchKeyboard(state, ' ', { onButton: true });
  assert.equal(prevented, false);
  assert.deepEqual(changes, []);
  assert.equal(state.rawExpression, '7');
});

test('Enter still evaluates when focus is not on a control (AUD-006)', () => {
  const state = new CalculatorState();
  state.inputDigit('2');
  state.inputOperator('+');
  state.inputDigit('2');
  const { prevented, changes } = dispatchKeyboard(state, 'Enter');
  assert.equal(prevented, true);
  assert.deepEqual(changes, ['equals']);
  assert.equal(state.resultString, '4');
});
