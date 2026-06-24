import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import {
  addPlayer,
  saveMatch,
  getPlayers,
  getAllMatches,
  deletePlayer,
  importAllData,
  exportAllData,
} from '../src/db';
import { makeMatch, makeLeg } from './helpers';

afterEach(async () => {
  await importAllData({ players: [], matches: [] }); // reset the shared fake DB
});

describe('deletePlayer cascade', () => {
  it('removes the player and every match they played in', async () => {
    const alice = await addPlayer('Alice');
    const bob = await addPlayer('Bob');
    await saveMatch(
      makeMatch({ id: 'm1', gameType: '501', playerIds: [alice.id, bob.id], legs: [makeLeg('m1', [])] }),
    );
    await saveMatch(
      makeMatch({ id: 'm2', gameType: '501', playerIds: [bob.id], legs: [makeLeg('m2', [])] }),
    );

    await deletePlayer(alice.id);

    expect((await getPlayers()).map((p) => p.id)).toEqual([bob.id]);
    // The shared match (m1) is gone; Bob's solo match (m2) survives — no match
    // is left referencing the deleted player.
    expect((await getAllMatches()).map((m) => m.id)).toEqual(['m2']);
  });
});

describe('importAllData validation', () => {
  it('drops malformed records instead of persisting data that crashes screens', async () => {
    const bundle = {
      players: [
        { id: 'p1', name: 'Valid', createdAt: 0 },
        { name: 'No id' }, // invalid: missing id
        null, // invalid
      ],
      matches: [
        makeMatch({ id: 'good', gameType: '501', playerIds: ['p1'], legs: [makeLeg('good', [])] }),
        { id: 'bad-no-legs', playerIds: ['p1'] }, // invalid: missing legs
        { id: 'bad-no-players', legs: [] }, // invalid: missing playerIds
      ],
    } as unknown as Parameters<typeof importAllData>[0];

    await expect(importAllData(bundle)).resolves.toBeUndefined(); // does not throw

    expect((await getPlayers()).map((p) => p.id)).toEqual(['p1']);
    expect((await getAllMatches()).map((m) => m.id)).toEqual(['good']);
  });

  it('round-trips a valid export', async () => {
    await addPlayer('Alice');
    const exported = await exportAllData();
    await importAllData({ players: [], matches: [] });
    await importAllData(exported);
    expect((await getPlayers()).map((p) => p.name)).toEqual(['Alice']);
  });
});
