import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../js/historyManager.js';
import { loadHistory } from '../js/storageManager.js';

const validToken = { char: '1', kind: 'digit', isExponent: false, hidden: false };

function makeEntry(index) {
  return {
    id: `entry-${index}`,
    timestamp: 1700000000000 + index,
    expression: '1+1',
    result: '2',
    tokens: [{ ...validToken }],
  };
}

function withStoredValue(value, callback) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: () => value,
    setItem: () => {},
    removeItem: () => {},
  } };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.warn = originalWarn;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('loadHistory caps persisted entries at 50 (AUD-009)', () => {
  const entries = Array.from({ length: 60 }, (_, index) => makeEntry(index));
  const loaded = withStoredValue(JSON.stringify(entries), () => loadHistory());
  assert.equal(loaded.length, 50);
  assert.equal(loaded[0].id, 'entry-0');
  assert.equal(loaded[49].id, 'entry-49');
});

test('loadHistory rejects malformed records and oversized token streams (AUD-009)', () => {
  const invalidEntries = [
    { timestamp: 1, expression: '1+1', result: '2' },
    { id: '', timestamp: 1, expression: '1+1', result: '2' },
    { id: 'bad-time', timestamp: null, expression: '1+1', result: '2' },
    { id: 'bad-result', timestamp: 1, expression: '1+1', result: 'nope' },
    { id: 'bad-tokens', timestamp: 1, expression: '1+1', result: '2', tokens: 'nope' },
    { id: 'bad-token-shape', timestamp: 1, expression: '1+1', result: '2', tokens: [{ char: '1', kind: 'digit' }] },
    {
      id: 'too-many-tokens',
      timestamp: 1,
      expression: '1+1',
      result: '2',
      tokens: Array.from({ length: 513 }, () => ({ ...validToken })),
    },
  ];
  const stored = [...invalidEntries, makeEntry(901), makeEntry(902)];
  const loaded = withStoredValue(JSON.stringify(stored), () => loadHistory());
  assert.deepEqual(loaded.map((entry) => entry.id), ['entry-901', 'entry-902']);
});

test('loadHistory returns an empty list for corrupt or non-array JSON (AUD-009)', () => {
  assert.deepEqual(withStoredValue('{not json', () => loadHistory()), []);
  assert.deepEqual(withStoredValue(JSON.stringify({ id: 'x' }), () => loadHistory()), []);
  assert.deepEqual(withStoredValue(null, () => loadHistory()), []);
});

test('HistoryManager.reload reflects writes from another tab (NEW-006)', () => {
  let stored = JSON.stringify([makeEntry(1)]);
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: () => stored,
    setItem: () => {},
    removeItem: () => {},
  } };
  try {
    const history = new HistoryManager();
    assert.equal(history.getAll().length, 1);

    // Simulate another tab appending a newer entry to the shared key.
    stored = JSON.stringify([makeEntry(2), makeEntry(1)]);
    const reloaded = history.reload();
    assert.equal(reloaded.length, 2);
    assert.equal(history.getAll()[0].id, 'entry-2');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

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
