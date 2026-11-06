import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../js/historyManager.js';

test('history manager reconciles in-memory entries with quota-trimmed persistence', () => {
  const previousWindow = globalThis.window;
  let stored = null;
  globalThis.window = { localStorage: {
    getItem: () => stored,
    setItem: (_key, value) => {
      if (JSON.parse(value).length > 5) {
        const error = new Error('Quota exceeded'); error.name = 'QuotaExceededError'; throw error;
      }
      stored = value;
    },
    removeItem: () => { stored = null; },
  } };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const history = new HistoryManager();
    for (let i = 0; i < 12; i += 1) history.add([], `expr-${i}`, String(i));
    assert.equal(history.getAll().length, 3);
    assert.equal(JSON.parse(stored).length, 3);
    assert.equal(history.lastSaveWasTrimmed, true);
    const reloaded = new HistoryManager();
    assert.equal(reloaded.getAll().length, 3);
  } finally {
    console.warn = originalWarn;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('history manager drops a new entry when storage cannot save even after fallback', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: () => null,
    setItem: () => { const error = new Error('Quota exceeded'); error.name = 'QuotaExceededError'; throw error; },
    removeItem: () => {},
  } };
  const originalWarn = console.warn; console.warn = () => {};
  try {
    const history = new HistoryManager();
    history.add([], 'new-expression', '42');
    assert.equal(history.getAll().length, 0);
    assert.equal(history.lastSaveFailed, true);
    assert.equal(history.lastSaveWasTrimmed, false);
  } finally {
    console.warn = originalWarn;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
