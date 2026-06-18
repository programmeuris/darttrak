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
import {
  atcDartsThrown,
  atcHits,
  atcHitRate,
  atcFewestDartsToComplete,
  atcRingLabel,
} from '../atc';
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
  const isAtc = match.gameType === 'AroundTheClock';

  const subtitle = isAtc
    ? `Around the Clock · ${atcRingLabel(match.atcRing ?? 'single')} · Best of ${match.format.legs}`
    : `${match.gameType} · Best of ${match.format.legs} · ${match.doubleOut ? 'Double Out' : 'Straight Out'}`;

  const playerCards = match.playerIds.map((id) => {
    const rows: [string, string][] = isAtc
      ? (() => {
          const fewest = atcFewestDartsToComplete(match.legs, id);
          return [
            ['Darts Thrown', String(atcDartsThrown(match.legs, id))],
            ['Hits', String(atcHits(match.legs, id))],
            ['Hit %', `${atcHitRate(match.legs, id).toFixed(0)}%`],
            ['Fewest to Clear', fewest > 0 ? String(fewest) : '—'],
          ];
        })()
      : (() => {
          const hs = countHighScores(match.legs, id);
          return [
            ['3-Dart Avg', calculateAverage(match.legs, id).toFixed(1)],
            ['Highest Turn', String(calculateHighestTurn(match.legs, id))],
            ['180s', String(count180s(match.legs, id))],
            ['100+', String(hs.over100)],
            ['140+', String(hs.over140)],
            ['Darts Thrown', String(totalDartsThrown(match.legs, id))],
            ['Checkout %', `${calculateCheckoutPercent(match.legs, id).toFixed(0)}%`],
            ['Best Checkout', bestCheckout(match.legs, id) > 0 ? String(bestCheckout(match.legs, id)) : '—'],
          ];
        })();

    return el(
      'section',
      { class: `card ${id === match.winnerId ? 'winner-card' : ''}` },
      [
        el('h2', { class: 'card-title' }, [
          nameOf(id),
          id === match.winnerId ? el('span', { class: 'badge' }, [' 🏆 Winner']) : null,
        ]),
        statGrid(rows),
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
        el('div', { class: 'muted' }, [subtitle]),
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
