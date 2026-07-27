/**
 * historyManager.js
 *
 * Maintains the calculation history list: newest-first ordering,
 * a max size cap, and persistence via storageManager.
 */

import { loadHistory, saveHistory, clearHistoryStorage } from './storageManager.js';

const MAX_HISTORY_ITEMS = 50;

export class HistoryManager {
  constructor() {
    /** @type {Array<{id:string, timestamp:number, expression:string, result:string}>} */
    this.entries = loadHistory();
  }

  getAll() {
    return this.entries;
  }

  /**
   * Adds a new entry to the front of the list, trimming to the max size.
   * @param {Array<object>} tokens - raw expression tokens (for exact restore)
   * @param {string} expression - display-friendly expression string
   * @param {string} result
   */
  add(tokens, expression, result) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      tokens: tokens.map((t) => ({ ...t })),
      expression,
      result,
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_HISTORY_ITEMS) {
      this.entries.length = MAX_HISTORY_ITEMS;
    }
    saveHistory(this.entries);
    return entry;
  }

  findById(id) {
    return this.entries.find((e) => e.id === id) || null;
  }

  clear() {
    this.entries = [];
    clearHistoryStorage();
  }
}
