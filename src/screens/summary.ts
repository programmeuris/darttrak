import { el, mount, header, toast } from '../ui';
import { navigate } from '../router';
import { getMatch, getPlayers } from '../db';
import {
  calculateAverage,
  calculateHighestTurn,
  count180s,
  countHighScores,
  calculateCheckoutPercent,
  bestCheckout,
  totalDartsThrown,
} from '../scoring';
import type { Player } from '../types';

export async function renderSummary(root: HTMLElement, matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) {
    toast('Match not found', 'error');
    navigate('/');
    return;
  }
  const players = await getPlayers();
  const names = new Map<string, string>(players.map((p: Player) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Unknown';

  const winnerName = match.winnerId ? nameOf(match.winnerId) : '—';

  const playerCards = match.playerIds.map((id) => {
    const avg = calculateAverage(match.legs, id);
    const high = calculateHighestTurn(match.legs, id);
    const c180 = count180s(match.legs, id);
    const hs = countHighScores(match.legs, id);
    const checkoutPct = calculateCheckoutPercent(match.legs, id);
    const best = bestCheckout(match.legs, id);
    const darts = totalDartsThrown(match.legs, id);

    return el(
      'section',
      { class: `card ${id === match.winnerId ? 'winner-card' : ''}` },
      [
        el('h2', { class: 'card-title' }, [
          nameOf(id),
          id === match.winnerId ? el('span', { class: 'badge' }, [' 🏆 Winner']) : null,
        ]),
        statGrid([
          ['3-Dart Avg', avg.toFixed(1)],
          ['Highest Turn', String(high)],
          ['180s', String(c180)],
          ['100+', String(hs.over100)],
          ['140+', String(hs.over140)],
          ['Darts Thrown', String(darts)],
          ['Checkout %', `${checkoutPct.toFixed(0)}%`],
          ['Best Checkout', best > 0 ? String(best) : '—'],
        ]),
      ],
    );
  });

  mount(
    root,
    el('div', { class: 'screen' }, [
      header('Match Summary', () => navigate('/')),
      el('section', { class: 'card winner-banner' }, [
        el('div', { class: 'winner-label' }, ['Winner']),
        el('div', { class: 'winner-name' }, [`🏆 ${winnerName}`]),
        el('div', { class: 'muted' }, [
          `${match.gameType} · Best of ${match.format.legs} · ${match.doubleOut ? 'Double Out' : 'Straight Out'}`,
        ]),
      ]),
      ...playerCards,
      el('div', { class: 'add-row' }, [
        el('button', { class: 'btn primary big full', onClick: () => navigate('/') }, [
          'Back to Home',
        ]),
      ]),
    ]),
  );
}

function statGrid(rows: [string, string][]): HTMLElement {
  return el(
    'div',
    { class: 'stat-grid' },
    rows.map(([label, value]) =>
      el('div', { class: 'stat-cell' }, [
        el('div', { class: 'stat-value' }, [value]),
        el('div', { class: 'stat-label' }, [label]),
      ]),
    ),
  );
}
