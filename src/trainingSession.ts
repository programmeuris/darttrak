/**
 * Entry points into training. Training isn't a match: it's started from the
 * Home screen (main player) or a player's profile — never from match setup —
 * and "starting" always means continuing the ongoing round when one exists.
 */

import { getAllMatches, saveMatch, uuid } from './db';
import { newTrainingState } from './training';
import type { Match } from './types';

/** A fresh training round record for the player. */
export function newTrainingRound(playerId: string): Match {
  const id = uuid();
  return {
    id,
    date: Date.now(),
    gameType: 'Training',
    playerIds: [playerId],
    winnerId: null,
    format: { legs: 1, sets: 1 },
    doubleOut: false,
    training: newTrainingState(),
    status: 'in_progress',
    legs: [{ id: uuid(), matchId: id, winnerId: null, turns: [] }],
  };
}

/** The player's ongoing round, or a freshly created one. Returns its match id. */
export async function startOrContinueTraining(playerId: string): Promise<string> {
  const existing = (await getAllMatches()).find(
    (m) => m.gameType === 'Training' && m.status === 'in_progress' && m.playerIds[0] === playerId,
  );
  if (existing) return existing.id;
  const fresh = newTrainingRound(playerId);
  await saveMatch(fresh);
  return fresh.id;
}
