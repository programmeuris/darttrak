import { el, mount, header } from '../ui';
import { navigate } from '../router';
import { getPlayers, getAllMatches } from '../db';
import {
  computePlayerOverview,
  averagePerMatch,
  scoreDistribution,
} from '../stats';
import { Chart } from 'chart.js/auto';
import type { Player, Match } from '../types';

let activeCharts: Chart[] = [];

function destroyCharts(): void {
  activeCharts.forEach((c) => c.destroy());
  activeCharts = [];
}

export async function renderPlayerStats(root: HTMLElement): Promise<void> {
  destroyCharts();
  const [players, matches] = await Promise.all([getPlayers(), getAllMatches()]);

  if (players.length === 0) {
    mount(
      root,
      el('div', { class: 'screen' }, [
        header('Player Stats', () => navigate('/')),
        el('p', { class: 'muted center' }, ['Add players to see stats.']),
      ]),
    );
    return;
  }

  const state = { playerId: players[0].id };
  const panel = el('div', { class: 'stats-panel' });

  const selector = el(
    'select',
    {
      class: 'select',
      onChange: (e: Event) => {
        state.playerId = (e.target as HTMLSelectElement).value;
        renderPanel();
      },
    },
    players.map((p: Player) => el('option', { value: p.id }, [p.name])),
  );

  function renderPanel(): void {
    destroyCharts();
    const overview = computePlayerOverview(matches, state.playerId);

    const statCells = el('div', { class: 'stat-grid' }, [
      cell(String(overview.matchesPlayed), 'Played'),
      cell(String(overview.matchesWon), 'Won'),
      cell(`${overview.winRate.toFixed(0)}%`, 'Win Rate'),
      cell(overview.overallAverage.toFixed(1), 'Overall Avg'),
      cell(overview.bestMatchAverage.toFixed(1), 'Best Match Avg'),
      cell(String(overview.total180s), '180s'),
      cell(overview.bestCheckout > 0 ? String(overview.bestCheckout) : '—', 'Best Checkout'),
    ]);

    const lineCanvas = el('canvas', {}) as HTMLCanvasElement;
    const barCanvas = el('canvas', {}) as HTMLCanvasElement;

    panel.replaceChildren(
      el('section', { class: 'card' }, [statCells]),
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Average Per Match']),
        el('div', { class: 'chart-wrap' }, [lineCanvas]),
      ]),
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Score Distribution']),
        el('div', { class: 'chart-wrap' }, [barCanvas]),
      ]),
    );

    buildCharts(lineCanvas, barCanvas, matches, state.playerId);
  }

  renderPanel();

  mount(
    root,
    el('div', { class: 'screen' }, [
      header('Player Stats', () => navigate('/')),
      el('section', { class: 'card' }, [
        el('label', { class: 'field-label' }, ['Player']),
        selector,
      ]),
      panel,
    ]),
  );
}

function cell(value: string, label: string): HTMLElement {
  return el('div', { class: 'stat-cell' }, [
    el('div', { class: 'stat-value' }, [value]),
    el('div', { class: 'stat-label' }, [label]),
  ]);
}

function buildCharts(
  lineCanvas: HTMLCanvasElement,
  barCanvas: HTMLCanvasElement,
  matches: Match[],
  playerId: string,
): void {
  const avgPoints = averagePerMatch(matches, playerId);
  const dist = scoreDistribution(matches, playerId);
  const textColor = '#eaeaea';
  const grid = 'rgba(234,234,234,0.1)';

  const lineChart = new Chart(lineCanvas, {
    type: 'line',
    data: {
      labels: avgPoints.map((p) => p.label),
      datasets: [
        {
          label: '3-Dart Avg',
          data: avgPoints.map((p) => Number(p.average.toFixed(1))),
          borderColor: '#e94560',
          backgroundColor: 'rgba(233,69,96,0.2)',
          tension: 0.25,
          fill: true,
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: grid } },
        y: { ticks: { color: textColor }, grid: { color: grid }, beginAtZero: true },
      },
    },
  });

  const barChart = new Chart(barCanvas, {
    type: 'bar',
    data: {
      labels: dist.labels,
      datasets: [
        {
          label: 'Turns',
          data: dist.counts,
          backgroundColor: '#0f9b58',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: grid } },
        y: { ticks: { color: textColor }, grid: { color: grid }, beginAtZero: true },
      },
    },
  });

  activeCharts.push(lineChart, barChart);
}
