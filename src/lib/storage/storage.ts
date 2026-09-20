/**
 * Storage Adapter Interface
 * Abstracts persistence so domain logic doesn't depend on localStorage directly.
 */

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
