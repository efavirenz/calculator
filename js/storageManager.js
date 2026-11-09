/**
 * storageManager.js
 *
 * Thin wrapper around window.localStorage. Centralizing key names and
 * try/catch handling here means the rest of the app never touches
 * localStorage directly (and stays testable / swappable later, e.g.
 * for IndexedDB).
 */

import { isValidToken } from './formatUtils.js';

const HISTORY_KEY = 'calculator.history.v1';
export const HISTORY_STORAGE_KEY = HISTORY_KEY;

const MAX_HISTORY_ITEMS = 50;
const MAX_TOKENS_PER_ENTRY = 512;

/**
 * Validates one persisted history entry at the storage trust boundary.
 * Entries may omit tokens (legacy result-only records) but, when present,
 * every token and the per-entry token count must be valid.
 * @param {unknown} entry
 * @returns {boolean}
 */
function isValidHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' || entry.id === '') return false;
  if (typeof entry.timestamp !== 'number' || !Number.isFinite(entry.timestamp)) return false;
  if (typeof entry.expression !== 'string') return false;
  if (
    typeof entry.result !== 'string' ||
    entry.result.trim() === '' ||
    !Number.isFinite(Number(entry.result))
  ) {
    return false;
  }
  if ('tokens' in entry) {
    if (!Array.isArray(entry.tokens)) return false;
    if (entry.tokens.length > MAX_TOKENS_PER_ENTRY) return false;
    if (!entry.tokens.every(isValidToken)) return false;
  }
  return true;
}

/**
 * @returns {Array<object>} validated history entries, newest first,
 * capped at the same 50-item limit enforced on write.
 */
export function loadHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidHistoryEntry).slice(0, MAX_HISTORY_ITEMS);
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
