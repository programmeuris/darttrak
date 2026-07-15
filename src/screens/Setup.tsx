import { useEffect, useState } from 'react';
import { navigate } from '../router';
import { toast } from '../toast';
import { readMainPlayer, readPref, writePref } from '../prefs';
import { Header } from '../components/Header';
import { getPlayers, saveMatch, uuid } from '../db';
import type { GameType, Match, Player, AtcRing } from '../types';

const GAMES: { type: GameType; label: string; enabled: boolean }[] = [
  { type: '501', label: '501', enabled: true },
  { type: '301', label: '301', enabled: true },
  { type: 'AroundTheClock', label: 'Around the Clock', enabled: true },
  { type: 'Cricket', label: 'Cricket', enabled: false },
];

const FORMATS = [
  { legs: 1, label: 'Best of 1' },
  { legs: 3, label: 'Best of 3' },
  { legs: 5, label: 'Best of 5' },
];

const RINGS: { ring: AtcRing; label: string }[] = [
  { ring: 'single', label: 'Any' },
  { ring: 'double', label: 'Doubles' },
  { ring: 'triple', label: 'Trebles' },
  { ring: 'progressive', label: 'Progressive' },
];

// The last-used configuration is remembered on the device, so a rematch with
// the usual settings is one tap. Each field is validated against the current
// options — an unknown stored value falls back to the default.
function storedSetup(): Partial<Pick<Match, 'gameType' | 'doubleOut' | 'atcRing'> & { legs: number }> {
  try {
    return JSON.parse(readPref('setup') ?? '{}');
  } catch {
    return {};
  }
}

export function Setup() {
  const stored = storedSetup();
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameType, setGameType] = useState<GameType>(() => {
    const g = GAMES.find((x) => x.type === stored.gameType);
    return g?.enabled ? g.type : '501';
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [legs, setLegs] = useState(() =>
    FORMATS.some((f) => f.legs === stored.legs) ? stored.legs! : 1,
  );
  const [doubleOut, setDoubleOut] = useState(stored.doubleOut !== false);
  const [ring, setRing] = useState<AtcRing>(() =>
    RINGS.some((r) => r.ring === stored.atcRing) ? stored.atcRing! : 'single',
  );

  useEffect(() => {
    writePref('setup', JSON.stringify({ gameType, legs, doubleOut, atcRing: ring }));
  }, [gameType, legs, doubleOut, ring]);

  const mainId = readMainPlayer();

  useEffect(() => {
    getPlayers()
      .then((ps) => {
        setPlayers(ps);
        // The device's main player starts every new game preselected.
        if (mainId && ps.some((p) => p.id === mainId)) {
          setSelected((s) => (s.length === 0 ? [mainId] : s));
        }
      })
      .catch((err) => {
        console.error(err);
        toast('Failed to load players', 'error');
      });
  }, [mainId]);

  const isAtc = gameType === 'AroundTheClock';

  function togglePlayer(id: string, checked: boolean) {
    if (checked) {
      if (selected.length >= 4) {
        toast('Max 4 players', 'error');
        return;
      }
      setSelected((s) => [...s, id]);
    } else {
      setSelected((s) => s.filter((x) => x !== id));
    }
  }

  async function startMatch() {
    if (selected.length < 1) {
      toast('Select at least one player', 'error');
      return;
    }
    const matchId = uuid();
    const match: Match = {
      id: matchId,
      date: Date.now(),
      gameType,
      playerIds: [...selected],
      winnerId: null,
      format: { legs, sets: 1 },
      doubleOut,
      atcRing: isAtc ? ring : undefined,
      status: 'in_progress',
      legs: [{ id: uuid(), matchId, winnerId: null, turns: [] }],
    };
    try {
      await saveMatch(match);
    } catch (err) {
      console.error(err);
      toast('Could not create the match. Try again.', 'error');
      return;
    }
    navigate(`/live/${matchId}`);
  }

  return (
    <div className="screen">
      <Header title="New Match" onBack={() => navigate('/')} />

      <section className="card">
        <h2 className="card-title">Game Type</h2>
        <div className="chip-row">
          {GAMES.map((g) => (
            <button
              key={g.type}
              className={`chip ${g.type === gameType ? 'active' : ''}`}
              aria-pressed={g.type === gameType}
              disabled={!g.enabled}
              title={g.enabled ? '' : 'Coming soon'}
              onClick={() => setGameType(g.type)}
            >
              {g.enabled ? g.label : `${g.label} (soon)`}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Players (1–4)</h2>
        {players.length === 0 ? (
          <p className="muted">No players yet — add some on the Home screen first.</p>
        ) : (
          <div className="check-grid">
            {players.map((p) => (
              <label className="check-item" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) => togglePlayer(p.id, e.target.checked)}
                />
                <span className="check-name">
                  {p.name}
                  {p.id === mainId && (
                    <span className="main-star" aria-label="Main player">
                      {' '}
                      ★
                    </span>
                  )}
                </span>
                {selected.includes(p.id) && (
                  <span
                    className="order-badge"
                    aria-label={`Throws ${selected.indexOf(p.id) + 1}`}
                  >
                    {selected.indexOf(p.id) + 1}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Format</h2>
        <div className="chip-row">
          {FORMATS.map((f) => (
            <button
              key={f.legs}
              className={`chip ${f.legs === legs ? 'active' : ''}`}
              aria-pressed={f.legs === legs}
              onClick={() => setLegs(f.legs)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {!isAtc && (
        <section className="card">
          <label className="toggle-row">
            <span>Double Out</span>
            <input
              type="checkbox"
              checked={doubleOut}
              onChange={(e) => setDoubleOut(e.target.checked)}
            />
          </label>
        </section>
      )}

      {isAtc && (
        <section className="card">
          <h2 className="card-title">Ring</h2>
          <p className="muted">
            Which ring must be hit. “Any” counts a hit anywhere on the number; Progressive also
            allows any ring but doubles advance +2 and trebles +3. Tracked separately in your stats.
          </p>
          <div className="chip-row">
            {RINGS.map((r) => (
              <button
                key={r.ring}
                className={`chip ${r.ring === ring ? 'active' : ''}`}
                aria-pressed={r.ring === ring}
                onClick={() => setRing(r.ring)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <button className="btn primary big full" onClick={startMatch}>
        Start Match
      </button>
    </div>
  );
}
