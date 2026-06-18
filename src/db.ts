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
  await db.delete('players', id);
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

export async function importAllData(data: ExportBundle): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['players', 'matches'], 'readwrite');
  // Overwrite existing data
  await tx.objectStore('players').clear();
  await tx.objectStore('matches').clear();
  for (const player of data.players ?? []) {
    await tx.objectStore('players').put(player);
  }
  for (const match of data.matches ?? []) {
    await tx.objectStore('matches').put(match);
  }
  await tx.done;
}

export { uuid };
