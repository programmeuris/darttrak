import './styles/main.css';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { navigate } from './router';
import { useRoute } from './useRoute';
import { getMatch } from './db';
import { toast } from './toast';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';
import { Live } from './screens/Live';
import { LiveAtc } from './screens/LiveAtc';
import { Summary } from './screens/Summary';
import { History } from './screens/History';
import { PlayerStats } from './screens/PlayerStats';
import { Profile } from './screens/Profile';

/**
 * Catches render-time errors so a single bad screen can't blank the whole app
 * (replaces the try/catch + toast the pre-React entry point had). Reset by the
 * route `key` on <ErrorBoundary> in Root, so navigating away clears the error.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="screen">
          <section className="card">
            <h2 className="card-title">Something went wrong</h2>
            <p className="muted">{this.state.error.message}</p>
            <button className="btn primary" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Redirects via an effect (after commit) instead of mutating the hash during render. */
function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to);
  }, [to]);
  return null;
}

/** Picks the x01 or Around the Clock live screen based on the match's game type. */
function LiveRoute({ matchId }: { matchId: string }) {
  const [isAtc, setIsAtc] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    getMatch(matchId).then((m) => {
      if (!active) return;
      if (!m) {
        toast('Match not found', 'error');
        setIsAtc(null);
        return;
      }
      setIsAtc(m.gameType === 'AroundTheClock');
    });
    return () => {
      active = false;
    };
  }, [matchId]);

  if (isAtc === undefined) return <div className="screen" />;
  if (isAtc === null) return <Redirect to="/" />;
  // key={matchId} so switching matches resets the live screen's input state.
  return isAtc ? (
    <LiveAtc key={matchId} matchId={matchId} />
  ) : (
    <Live key={matchId} matchId={matchId} />
  );
}

function Screen({ name, params }: { name: string; params: string[] }) {
  switch (name) {
    case 'home':
      return <Home />;
    case 'setup':
      return <Setup />;
    case 'live':
      if (!params[0]) return <Redirect to="/" />;
      return <LiveRoute matchId={params[0]} />;
    case 'summary':
      if (!params[0]) return <Redirect to="/" />;
      return <Summary matchId={params[0]} />;
    case 'history':
      return <History matchId={params[0]} />;
    case 'stats':
      return <PlayerStats />;
    case 'player': {
      // /player/:id, /player/:id/stats, /player/:id/history[/:matchId]
      const id = params[0];
      if (!id) return <Redirect to="/" />;
      switch (params[1]) {
        case undefined:
          return <Profile playerId={id} />;
        case 'stats':
          return <PlayerStats playerId={id} />;
        case 'history':
          return <History playerId={id} matchId={params[2]} />;
        default:
          return <Redirect to={`/player/${id}`} />;
      }
    }
    default:
      return <Redirect to="/" />;
  }
}

function App() {
  const { name, params } = useRoute();
  const routeKey = `${name}/${params.join('/')}`;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [routeKey]);

  // Keying the boundary by route both resets caught errors on navigation and
  // remounts the screen (so per-screen state never leaks across routes).
  return (
    <ErrorBoundary key={routeKey}>
      <Screen name={name} params={params} />
    </ErrorBoundary>
  );
}

if (!location.hash) location.hash = '#/';
createRoot(document.getElementById('app')!).render(<App />);
