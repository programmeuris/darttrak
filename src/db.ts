import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Player, Match, ExportBundle } from './types';

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

export async function exportAllData(): Promise<ExportBundle> {
  const db = await getDB();
  const players = await db.getAll('players');
  const matches = await db.getAll('matches');
  return { players, matches };
}

// Minimal shape guards — this is a local-only DB, so the goal is just to keep a
// malformed backup from persisting records that crash screens later (missing
// id / playerIds / legs), not to fully validate every field.
function isValidPlayer(p: unknown): p is Player {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as Player).id === 'string' &&
    typeof (p as Player).name === 'string'
  );
}
function isValidMatch(m: unknown): m is Match {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as Match).id === 'string' &&
    Array.isArray((m as Match).playerIds) &&
    Array.isArray((m as Match).legs)
  );
}

export async function importAllData(data: ExportBundle): Promise<void> {
  const players = (data.players ?? []).filter(isValidPlayer);
  const matches = (data.matches ?? []).filter(isValidMatch);
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
