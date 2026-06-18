import './styles/main.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigate } from './router';
import { useRoute } from './useRoute';
import { getMatch } from './db';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';
import { Live } from './screens/Live';
import { LiveAtc } from './screens/LiveAtc';
import { Summary } from './screens/Summary';
import { History } from './screens/History';
import { PlayerStats } from './screens/PlayerStats';

/** Picks the x01 or Around the Clock live screen based on the match's game type. */
function LiveRoute({ matchId }: { matchId: string }) {
  const [isAtc, setIsAtc] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    getMatch(matchId).then((m) => {
      if (!active) return;
      setIsAtc(m ? m.gameType === 'AroundTheClock' : null);
    });
    return () => {
      active = false;
    };
  }, [matchId]);

  if (isAtc === undefined) return <div className="screen" />;
  if (isAtc === null) {
    navigate('/');
    return null;
  }
  return isAtc ? <LiveAtc matchId={matchId} /> : <Live matchId={matchId} />;
}

function App() {
  const { name, params } = useRoute();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [name, params.join('/')]);

  switch (name) {
    case 'home':
      return <Home />;
    case 'setup':
      return <Setup />;
    case 'live':
      if (!params[0]) {
        navigate('/');
        return null;
      }
      return <LiveRoute matchId={params[0]} />;
    case 'summary':
      if (!params[0]) {
        navigate('/');
        return null;
      }
      return <Summary matchId={params[0]} />;
    case 'history':
      return <History matchId={params[0]} />;
    case 'stats':
      return <PlayerStats />;
    default:
      navigate('/');
      return null;
  }
}

if (!location.hash) location.hash = '#/';
createRoot(document.getElementById('app')!).render(<App />);
