import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Player, Match, Leg, ExportBundle } from './types';

interface DartsDB extends DBSchema {
  players: {
    key: string;
    value: Player;
  };
  matches: {
    key: string;
    value: Match;
  };
}

const DB_NAME = 'darts-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DartsDB>> | null = null;

function getDB(): Promise<IDBPDatabase<DartsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DartsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('players')) {
          db.createObjectStore('players', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('matches')) {
          db.createObjectStore('matches', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---- Players ----

export async function getPlayers(): Promise<Player[]> {
  const db = await getDB();
  const players = await db.getAll('players');
  return players.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPlayer(id: string): Promise<Player | undefined> {
  const db = await getDB();
  return db.get('players', id);
}

export async function addPlayer(name: string): Promise<Player> {
  const db = await getDB();
  const player: Player = {
    id: uuid(),
    name: name.trim(),
    createdAt: Date.now(),
  };
  await db.put('players', player);
  return player;
}

export async function deletePlayer(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['players', 'matches'], 'readwrite');
  await tx.objectStore('players').delete(id);
  // Cascade: remove any match this player took part in, so no match is left
  // referencing a now-missing player.
  const matchStore = tx.objectStore('matches');
  for (const match of await matchStore.getAll()) {
    if (match.playerIds.includes(id)) await matchStore.delete(match.id);
  }
  await tx.done;
}

// ---- Matches ----

export async function saveMatch(match: Match): Promise<void> {
  const db = await getDB();
  await db.put('matches', match);
}

export async function getMatch(id: string): Promise<Match | undefined> {
  const db = await getDB();
  return db.get('matches', id);
}

export async function getAllMatches(): Promise<Match[]> {
  const db = await getDB();
  const matches = await db.getAll('matches');
  return matches.sort((a, b) => b.date - a.date);
}

export async function getMatchesByPlayer(playerId: string): Promise<Match[]> {
  const matches = await getAllMatches();
  return matches.filter((m) => m.playerIds.includes(playerId));
}

export async function deleteMatch(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('matches', id);
}

// ---- Export / Import ----

/** Bump when the stored record shape changes, so imports can tell old
 * backups (migrate) from newer-app backups (reject) instead of silently
 * dropping records whose shape no longer validates. */
export const EXPORT_VERSION = 1;

export async function exportAllData(): Promise<ExportBundle> {
  const db = await getDB();
  const players = await db.getAll('players');
  const matches = await db.getAll('matches');
  return { version: EXPORT_VERSION, players, matches };
}

// Shape guards for imported records. Import replaces the whole DB, so an
// invalid record means a corrupt or wrong file and the import is rejected
// outright — the data currently in the DB is the user's only other copy.
// The match guard covers every field a screen dereferences unconditionally
// (format.legs, leg.turns, dart lists, playerIds rotation), so a bad record
// can't persist and then crash History/Live/Stats on every visit.
function isValidPlayer(p: unknown): p is Player {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as Player).id === 'string' &&
    typeof (p as Player).name === 'string'
  );
}
function isValidLeg(l: unknown): l is Leg {
  if (typeof l !== 'object' || l === null) return false;
  const leg = l as Leg;
  return (
    Array.isArray(leg.turns) &&
    leg.turns.every(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        typeof t.playerId === 'string' &&
        Array.isArray(t.darts),
    )
  );
}
function isValidMatch(m: unknown): m is Match {
  if (typeof m !== 'object' || m === null) return false;
  const match = m as Match;
  return (
    typeof match.id === 'string' &&
    typeof match.date === 'number' &&
    (match.status === 'completed' || match.status === 'in_progress') &&
    typeof match.format === 'object' &&
    match.format !== null &&
    typeof match.format.legs === 'number' &&
    Array.isArray(match.playerIds) &&
    match.playerIds.length >= 1 &&
    match.playerIds.every((id) => typeof id === 'string') &&
    Array.isArray(match.legs) &&
    match.legs.length >= 1 &&
    match.legs.every(isValidLeg)
  );
}

/**
 * Replace the entire DB with the bundle's contents. All-or-nothing: the
 * bundle is fully validated before anything is touched, and the clear +
 * writes share one transaction — a failed import never leaves partial data.
 * Throws (with a user-facing message) on unsupported versions or invalid
 * records; existing data is untouched in that case.
 */
export async function importAllData(data: ExportBundle): Promise<void> {
  const version = data.version ?? EXPORT_VERSION; // pre-versioning backups = v1
  if (typeof version !== 'number' || version > EXPORT_VERSION) {
    throw new Error('this backup was made by a newer version of DartTrak');
  }
  const players = data.players ?? [];
  const matches = data.matches ?? [];
  const badPlayers = players.filter((p) => !isValidPlayer(p)).length;
  const badMatches = matches.filter((m) => !isValidMatch(m)).length;
  if (badPlayers > 0 || badMatches > 0) {
    throw new Error(
      `the file contains ${badPlayers + badMatches} invalid record(s) — nothing was imported`,
    );
  }
  const db = await getDB();
  const tx = db.transaction(['players', 'matches'], 'readwrite');
  // Overwrite existing data
  await tx.objectStore('players').clear();
  await tx.objectStore('matches').clear();
  for (const player of players) {
    await tx.objectStore('players').put(player);
  }
  for (const match of matches) {
    await tx.objectStore('matches').put(match);
  }
  await tx.done;
}

export { uuid };
