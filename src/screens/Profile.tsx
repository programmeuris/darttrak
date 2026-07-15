import { useEffect, useState } from 'react';
import { navigate } from '../router';
import { toast } from '../toast';
import { Header } from '../components/Header';
import { getPlayer, getMatchesByPlayer } from '../db';
import { readMainPlayer, writeMainPlayer } from '../prefs';
import { startOrContinueTraining } from '../trainingSession';
import type { Player } from '../types';

/**
 * Per-player landing page. Analytics and history are reached from here so they
 * stay bound to a single player; the disabled Settings entry marks where future
 * per-player preferences (e.g. checkout tables) will live.
 */
export function Profile({ playerId }: { playerId: string }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [isMain, setIsMain] = useState(() => readMainPlayer() === playerId);

  // The main-player setting lives here, on the player's own page, rather than
  // as a tap target in the roster list — deliberate to set, hard to fat-finger.
  // Setting it silently takes the star from whoever held it (one per device).
  function toggleMain() {
    if (!player) return;
    const next = !isMain;
    setIsMain(next);
    writeMainPlayer(next ? playerId : null);
    toast(next ? `${player.name} is now the main player` : 'Main player cleared');
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const p = await getPlayer(playerId);
      if (!active) return;
      if (!p) {
        toast('Player not found', 'error');
        navigate('/', { replace: true });
        return;
      }
      setPlayer(p);
      const matches = await getMatchesByPlayer(playerId);
      if (active) setMatchCount(matches.length);
    })().catch((err) => {
      // Without this a rejected read strands the user on a blank screen.
      if (!active) return;
      console.error(err);
      toast('Failed to load the profile', 'error');
      navigate('/', { replace: true });
    });
    return () => {
      active = false;
    };
  }, [playerId]);

  if (!player) return <div className="screen" />;

  return (
    <div className="screen">
      <Header title={player.name} onBack={() => navigate('/')} />

      <section className="card">
        <p className="muted center">
          {matchCount} {matchCount === 1 ? 'match' : 'matches'} played
        </p>
      </section>

      <div className="home-actions">
        <button className="btn primary big" onClick={() => navigate(`/player/${playerId}/stats`)}>
          📊 Analytics
        </button>
        <button
          className="btn"
          onClick={async () => {
            try {
              navigate(`/live/${await startOrContinueTraining(playerId)}`);
            } catch (err) {
              console.error(err);
              toast('Could not start training. Try again.', 'error');
            }
          }}
        >
          🎓 Training
        </button>
        <button className="btn" onClick={() => navigate(`/player/${playerId}/history`)}>
          History
        </button>
        <button className="btn" aria-pressed={isMain} onClick={toggleMain}>
          {isMain ? '★ Main player' : '☆ Set as main player'}
        </button>
        <button className="btn" disabled title="Coming soon">
          Settings · coming soon
        </button>
      </div>
    </div>
  );
}
