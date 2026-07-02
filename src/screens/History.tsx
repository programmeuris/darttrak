import { useEffect, useState } from 'react';
import { navigate } from '../router';
import { toast, confirmDialog } from '../toast';
import { Header } from '../components/Header';
import { getAllMatches, getPlayers, getMatch, deleteMatch } from '../db';
import { startingScore } from '../scoring';
import { ATC_TARGET_COUNT, atcRingLabel } from '../atc';
import type { Match, Player, GameType } from '../types';

// `playerId`, when set, scopes the screen to a single player's matches (reached
// from that player's profile) and keeps navigation within the profile.
export function History({ matchId, playerId }: { matchId?: string; playerId?: string }) {
  const base = playerId ? `/player/${playerId}/history` : '/history';
  if (matchId) return <MatchDetail matchId={matchId} backTo={base} />;
  return <MatchList lockedPlayerId={playerId} base={base} />;
}

function MatchList({ lockedPlayerId, base }: { lockedPlayerId?: string; base: string }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [playerFilter, setPlayerFilter] = useState(lockedPlayerId ?? '');
  const [gameFilter, setGameFilter] = useState<'' | GameType>('');

  useEffect(() => {
    Promise.all([getAllMatches(), getPlayers()])
      .then(([ms, players]) => {
        setMatches(ms);
        setNames(new Map(players.map((p: Player) => [p.id, p.name])));
      })
      .catch((err) => {
        console.error(err);
        toast('Failed to load history', 'error');
      });
  }, []);

  const nameOf = (id: string) => names.get(id) ?? 'Unknown';
  const players = [...names.entries()];
  const list = matches
    .filter((m) => !playerFilter || m.playerIds.includes(playerFilter))
    .filter((m) => !gameFilter || m.gameType === gameFilter);

  async function handleDelete(m: Match) {
    if (!confirmDialog('Delete this match permanently?')) return;
    try {
      await deleteMatch(m.id);
    } catch (err) {
      console.error(err);
      toast('Delete failed — nothing was removed. Try again.', 'error');
      return;
    }
    setMatches((ms) => ms.filter((x) => x.id !== m.id));
    toast('Match deleted');
  }

  return (
    <div className="screen">
      <Header
        title={lockedPlayerId ? `${names.get(lockedPlayerId) ?? 'Player'} · History` : 'Match History'}
        onBack={() => navigate(lockedPlayerId ? `/player/${lockedPlayerId}` : '/')}
      />
      <section className="card">
        <div className="filter-row">
          {!lockedPlayerId && (
            <select className="select" value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)}>
              <option value="">All players</option>
              {players.map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <select className="select" value={gameFilter} onChange={(e) => setGameFilter(e.target.value as '' | GameType)}>
            <option value="">All games</option>
            <option value="501">501</option>
            <option value="301">301</option>
            <option value="AroundTheClock">Around the Clock</option>
          </select>
        </div>
      </section>

      <div className="match-list">
        {list.length === 0 ? (
          <p className="muted center">No matches found.</p>
        ) : (
          list.map((m) => (
            <div className="match-row" key={m.id}>
              <button
                className="match-main"
                onClick={() => navigate(m.status === 'in_progress' ? `/live/${m.id}` : `${base}/${m.id}`)}
              >
                <div className="match-line1">
                  <span className="match-game">{m.gameType}</span>
                  <span className="match-date">{new Date(m.date).toLocaleDateString()}</span>
                </div>
                <div className="match-players">{m.playerIds.map(nameOf).join(' vs ')}</div>
                {m.status === 'in_progress' ? (
                  <span className="tag in-progress">In progress</span>
                ) : (
                  <span className="tag">🏆 {m.winnerId ? nameOf(m.winnerId) : '—'}</span>
                )}
              </button>
              <button className="icon-btn danger" aria-label="Delete match" onClick={() => handleDelete(m)}>
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MatchDetail({ matchId, backTo }: { matchId: string; backTo: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    (async () => {
      const m = await getMatch(matchId);
      if (!active) return;
      if (!m) {
        toast('Match not found', 'error');
        navigate(backTo);
        return;
      }
      const players = await getPlayers();
      if (!active) return;
      setNames(new Map(players.map((p: Player) => [p.id, p.name])));
      setMatch(m);
    })().catch((err) => {
      // Without this a rejected read strands the user on a blank screen.
      if (!active) return;
      console.error(err);
      toast('Failed to load the match', 'error');
      navigate(backTo);
    });
    return () => {
      active = false;
    };
  }, [matchId, backTo]);

  if (!match) return <div className="screen" />;

  const nameOf = (id: string) => names.get(id) ?? 'Unknown';
  const isAtc = match.gameType === 'AroundTheClock';
  const start = startingScore(match.gameType === '301' ? '301' : '501');
  const cols = isAtc ? ['Player', 'Darts', 'Hits', 'Cleared'] : ['Player', 'Darts', 'Scored', 'Left'];

  return (
    <div className="screen">
      <Header title="Match Detail" onBack={() => navigate(backTo)} />

      <section className="card">
        <div className="match-line1">
          <span className="match-game">{match.gameType}</span>
          <span className="match-date">{new Date(match.date).toLocaleString()}</span>
        </div>
        <div className="match-players">{match.playerIds.map(nameOf).join(' vs ')}</div>
        <div className="muted">
          {isAtc
            ? `Best of ${match.format.legs} · ${atcRingLabel(match.atcRing ?? 'single')}`
            : `Best of ${match.format.legs} · ${match.doubleOut ? 'Double Out' : 'Straight Out'} · Start ${start}`}
        </div>
        {match.status === 'completed' ? (
          <div className="tag">🏆 {match.winnerId ? nameOf(match.winnerId) : '—'}</div>
        ) : (
          <button className="btn primary" onClick={() => navigate(`/live/${match.id}`)}>
            Resume Match
          </button>
        )}
      </section>

      {match.legs.map((leg, i) => (
        <section className="card" key={leg.id}>
          <h2 className="card-title">
            Leg {i + 1}
            {leg.winnerId && <span className="badge"> · {nameOf(leg.winnerId)}</span>}
          </h2>
          <table className="turn-table">
            <thead>
              <tr>
                {cols.map((c, ci) => (
                  <th className={ci >= 2 ? 'num' : ''} key={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leg.turns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No turns
                  </td>
                </tr>
              ) : (
                leg.turns.map((turn, ti) => (
                  <tr className={turn.isBust ? 'bust' : ''} key={ti}>
                    <td>{nameOf(turn.playerId)}</td>
                    <td>{turn.darts.map((d) => d.label).join(' · ')}</td>
                    <td className="num">{isAtc ? `+${turn.totalScore}` : turn.isBust ? 'BUST' : turn.totalScore}</td>
                    <td className="num">
                      {isAtc ? `${turn.remainingScore}/${ATC_TARGET_COUNT}` : turn.remainingScore}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ))}

      {match.status === 'completed' && (
        <button className="btn full" onClick={() => navigate(`/summary/${match.id}`)}>
          View Summary
        </button>
      )}
    </div>
  );
}
