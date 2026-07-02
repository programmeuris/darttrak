/**
 * Per-device UI preferences (remembered toggles, last-used settings). These
 * live in localStorage rather than the data model: they're cosmetic, device
 * local, and losing them is harmless — so reads and writes fall back
 * silently when storage is unavailable (e.g. private mode).
 */

const PREFIX = 'darttrak:';

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore write failures
  }
}
