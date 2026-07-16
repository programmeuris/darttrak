import { useEffect, useState } from 'react';
import { navigate } from '../router';
import { toast } from '../toast';
import { Header } from '../components/Header';
import { getPlayer, getMatchesByPlayer } from '../db';
import { clearPref, readMainPlayer, readPref, writeMainPlayer, writePref } from '../prefs';
import { startOrContinueTraining } from '../trainingSession';
import type { TrainingVariant } from '../training';
import type { Player } from '../types';

/**
 * Per-player landing page. Analytics and history are reached from here so they
 * stay bound to a single player, and per-player preferences (main player, the
 * training trend window) live here rather than on the screens they affect.
 */
export function Profile({ playerId }: { playerId: string }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [isMain, setIsMain] = useState(() => readMainPlayer() === playerId);
  const [trendWindow, setTrendWindow] = useState(
    () => readPref(`trainingTrendWindow:${playerId}`) ?? '',
  );

  // The training tab's ▲▼ markers compare round halves by default; a window
  // of N compares the last N rounds against the N before them instead.
  // Digits only, no leading zero — empty means "halves of all rounds".
  function changeTrendWindow(raw: string) {
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 3);
    setTrendWindow(digits);
    if (digits) writePref(`trainingTrendWindow:${playerId}`, digits);
    else clearPref(`trainingTrendWindow:${playerId}`);
  }

  async function startTraining(variant: TrainingVariant) {
    try {
      navigate(`/live/${await startOrContinueTraining(playerId, variant)}`);
    } catch (err) {
      console.error(err);
      toast('Could not start training. Try again.', 'error');
    }
  }

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
        <button className="btn" onClick={() => startTraining('sink')}>
          🚰 Kitchen Sink
        </button>
        <button className="btn" onClick={() => startTraining('group')}>
          🛋️ Group Therapy
        </button>
        <button className="btn" onClick={() => navigate(`/player/${playerId}/history`)}>
          History
        </button>
        <button className="btn" aria-pressed={isMain} onClick={toggleMain}>
          {isMain ? '★ Main player' : '☆ Set as main player'}
        </button>
      </div>

      <section className="card">
        <h2 className="card-title">Stats Settings</h2>
        <label className="field-label" htmlFor="trend-window">
          Training improvement window (rounds)
        </label>
        <input
          id="trend-window"
          className="text-input"
          inputMode="numeric"
          placeholder="All rounds (compare halves)"
          value={trendWindow}
          onChange={(e) => changeTrendWindow(e.target.value)}
        />
        <p className="muted">
          The ▲▼ markers on the training stats compare your recent rounds with earlier ones. Set a
          window of N to compare the last N rounds against the N before them — more responsive to
          current form. Empty compares the first and last halves of all your rounds; a window also
          falls back to that until 2×N rounds exist.
        </p>
      </section>
    </div>
  );
}
