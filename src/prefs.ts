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

export function clearPref(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

// The device's main player (only ever one): starred on the roster, preselected
// for new games, and the default player on the stats screen.
export function readMainPlayer(): string | null {
  return readPref('mainPlayer');
}

export function writeMainPlayer(id: string | null): void {
  if (id === null) clearPref('mainPlayer');
  else writePref('mainPlayer', id);
}
