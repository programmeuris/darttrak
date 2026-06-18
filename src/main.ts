import './styles/main.css';
import { parseRoute, navigate } from './router';
import { renderHome } from './screens/home';
import { renderSetup } from './screens/setup';
import { renderLive } from './screens/live';
import { renderLiveAtc } from './screens/liveAtc';
import { renderSummary } from './screens/summary';
import { renderHistory } from './screens/history';
import { renderPlayerStats } from './screens/playerStats';
import { getMatch } from './db';
import { toast } from './ui';

const root = document.getElementById('app')!;

async function render(): Promise<void> {
  const { name, params } = parseRoute();
  try {
    switch (name) {
      case 'home':
        await renderHome(root);
        break;
      case 'setup':
        await renderSetup(root);
        break;
      case 'live': {
        if (!params[0]) return navigate('/');
        const liveMatch = await getMatch(params[0]);
        if (liveMatch?.gameType === 'AroundTheClock') {
          await renderLiveAtc(root, params[0]);
        } else {
          await renderLive(root, params[0]);
        }
        break;
      }
      case 'summary':
        if (!params[0]) return navigate('/');
        await renderSummary(root, params[0]);
        break;
      case 'history':
        await renderHistory(root, params[0]);
        break;
      case 'stats':
        await renderPlayerStats(root);
        break;
      default:
        navigate('/');
    }
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    toast(`Error: ${(err as Error).message}`, 'error');
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('load', () => {
  if (!location.hash) location.hash = '#/';
  render();
});

// Render immediately in case load already fired.
if (document.readyState !== 'loading') {
  if (!location.hash) location.hash = '#/';
  render();
}
