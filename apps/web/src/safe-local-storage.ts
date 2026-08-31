/** Optional UI preferences only: denied browser storage must not block rendering. */
export function readLocalStorageItem(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // The caller keeps its current UI state in memory when persistence is denied.
  }
}
