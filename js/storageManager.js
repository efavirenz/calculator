/**
 * storageManager.js
 *
 * Thin wrapper around window.localStorage. Centralizing key names and
 * try/catch handling here means the rest of the app never touches
 * localStorage directly (and stays testable / swappable later, e.g.
 * for IndexedDB).
 */

const HISTORY_KEY = 'calculator.history.v1';

/**
 * @returns {Array<object>} stored history entries, newest first.
 */
export function loadHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.expression === 'string' &&
        typeof entry.result === 'string' &&
        (!('tokens' in entry) || (Array.isArray(entry.tokens) && entry.tokens.every(
          (t) => t && typeof t === 'object' && typeof t.char === 'string' && typeof t.kind === 'string'
        )))
    );
  } catch (err) {
    console.warn('Failed to load history from storage:', err);
    return [];
  }
}

/**
 * Persists the full history array.
 * @param {Array<object>} entries
 * @returns {{success:boolean, entries:Array<object>, trimmed:boolean}} persistence status and retained entries
 */
export function saveHistory(entries) {
  if (!Array.isArray(entries)) return { success: false, entries: [], trimmed: false };
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    return { success: true, entries: [...entries], trimmed: false };
  } catch (err) {
    if (entries.length > 5) {
      const reduced = entries.slice(0, Math.floor(entries.length / 2));
      const result = saveHistory(reduced);
      return { ...result, trimmed: result.success };
    }
    console.warn('Failed to save history to storage:', err);
    return { success: false, entries: [], trimmed: false };
  }
}

export function clearHistoryStorage() {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
    return true;
  } catch (err) {
    console.warn('Failed to clear history storage:', err);
    return false;
  }
}
