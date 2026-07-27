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
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to load history from storage:', err);
    return [];
  }
}

/**
 * Persists the full history array.
 * @param {Array<object>} entries
 */
export function saveHistory(entries) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn('Failed to save history to storage:', err);
  }
}

export function clearHistoryStorage() {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.warn('Failed to clear history storage:', err);
  }
}
