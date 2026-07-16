/**
 * Entry points into training. Training isn't a match: it's started from the
 * Home screen (main player) or a player's profile — never from match setup —
 * and "starting" always means continuing the ongoing round when one exists.
 */

import { getAllMatches, saveMatch, uuid } from './db';
import { newTrainingState, nextRoundBag } from './training';
import type { Match } from './types';
import type { TrainingState } from './training';

/**
 * A fresh training round record for the player. When the round rolls over
 * from a previous one, pass that round's pre-dealt `nextBag` as `order` so
 * the targets the player was shown coming up are the ones actually dealt.
 */
export function newTrainingRound(playerId: string, order?: string[]): Match {
  const id = uuid();
  const training: TrainingState = order?.length
    ? {
        target: order[0],
        bag: order.slice(1),
        nextBag: nextRoundBag(order[order.length - 1]),
      }
    : newTrainingState();
  return {
    id,
    date: Date.now(),
    gameType: 'Training',
    playerIds: [playerId],
    winnerId: null,
    format: { legs: 1, sets: 1 },
    doubleOut: false,
    training,
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
