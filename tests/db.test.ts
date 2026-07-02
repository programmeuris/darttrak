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
  EXPORT_VERSION,
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
  // Import replaces the whole DB, so a bundle with ANY invalid record is
  // rejected outright — importing the wrong file must never wipe real data.
  it('rejects a bundle containing malformed records and leaves existing data untouched', async () => {
    const keep = await addPlayer('Keep');
    const bundle = {
      players: [
        { id: 'p1', name: 'Valid', createdAt: 0 },
        { name: 'No id' }, // invalid: missing id
      ],
      matches: [
        makeMatch({ id: 'good', gameType: '501', playerIds: ['p1'], legs: [makeLeg('good', [])] }),
      ],
    } as unknown as Parameters<typeof importAllData>[0];

    await expect(importAllData(bundle)).rejects.toThrow(/invalid record/);

    // Nothing was cleared or written — the valid records were not kept either.
    expect((await getPlayers()).map((p) => p.id)).toEqual([keep.id]);
    expect(await getAllMatches()).toEqual([]);
  });

  it('rejects matches that would crash screens after import', async () => {
    const valid = () =>
      makeMatch({ id: 'v', gameType: '501', playerIds: ['p1'], legs: [makeLeg('v', [])] });
    const broken = [
      { ...valid(), format: undefined }, // History/Live read format.legs
      { ...valid(), playerIds: [] }, // turn rotation divides by player count
      { ...valid(), legs: [] }, // resuming reads the active leg
      { ...valid(), legs: [{}] }, // every stats module iterates leg.turns
      { ...valid(), status: 'bogus' }, // list would offer Resume on garbage
      { ...valid(), date: undefined }, // match ordering sorts by date
    ];
    for (const m of broken) {
      const bundle = { players: [], matches: [m] } as unknown as Parameters<
        typeof importAllData
      >[0];
      await expect(importAllData(bundle)).rejects.toThrow(/invalid record/);
    }
  });

  it('rejects backups from a newer app version and accepts legacy unversioned ones', async () => {
    await expect(
      importAllData({ version: EXPORT_VERSION + 1, players: [], matches: [] }),
    ).rejects.toThrow(/newer version/);

    // Backups made before versioning have no marker and import as v1.
    await importAllData({
      players: [{ id: 'p-old', name: 'Old', createdAt: 0 }],
      matches: [],
    });
    expect((await getPlayers()).map((p) => p.name)).toEqual(['Old']);
  });

  it('round-trips a valid export, stamped with the current version', async () => {
    await addPlayer('Alice');
    const exported = await exportAllData();
    expect(exported.version).toBe(EXPORT_VERSION);
    await importAllData({ players: [], matches: [] });
    await importAllData(exported);
    expect((await getPlayers()).map((p) => p.name)).toEqual(['Alice']);
  });
});
