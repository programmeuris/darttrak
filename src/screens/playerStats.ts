import { el, mount, header } from '../ui';
import { navigate } from '../router';
import { getPlayers, getAllMatches } from '../db';
import {
  computePlayerOverview,
  averagePerMatch,
  scoreDistribution,
} from '../stats';
import {
  consistencyStats,
  finishingStats,
  scoringStats,
  headToHead,
} from '../analysis';
import { atcStatsByVariant, atcPerMatch, atcRingLabel } from '../atc';
import { Chart, type ChartDataset } from 'chart.js/auto';
import type { Player, Match, AtcRing } from '../types';

const TEXT = '#eaeaea';
const GRID = 'rgba(234,234,234,0.1)';
const ACCENT = '#e94560';
const GREEN = '#0f9b58';
const BLUE = '#4a8fe0';
const AMBER = '#f5c451';

const RING_COLORS: Record<AtcRing, string> = {
  single: BLUE,
  double: GREEN,
  triple: AMBER,
  progressive: ACCENT,
};

type TabId = 'overview' | 'consistency' | 'finishing' | 'scoring' | 'h2h' | 'atc';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'consistency', label: 'Consistency' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'h2h', label: 'Head-to-Head' },
  { id: 'atc', label: 'Around the Clock' },
];

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

  const names = new Map<string, string>(players.map((p) => [p.id, p.name]));
  const state = { playerId: players[0].id, tab: 'overview' as TabId };
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

  const tabBar = el(
    'div',
    { class: 'tab-bar' },
    TABS.map((t) =>
      el(
        'button',
        {
          class: `tab ${t.id === state.tab ? 'active' : ''}`,
          onClick: () => {
            if (state.tab === t.id) return;
            state.tab = t.id;
            for (const child of Array.from(tabBar.children)) {
              child.classList.toggle(
                'active',
                child.getAttribute('data-tab') === t.id,
              );
            }
            renderPanel();
          },
          'data-tab': t.id,
        },
        [t.label],
      ),
    ),
  );

  function renderPanel(): void {
    destroyCharts();
    switch (state.tab) {
      case 'overview':
        renderOverview(panel, matches, state.playerId);
        break;
      case 'consistency':
        renderConsistency(panel, matches, state.playerId);
        break;
      case 'finishing':
        renderFinishing(panel, matches, state.playerId);
        break;
      case 'scoring':
        renderScoring(panel, matches, state.playerId);
        break;
      case 'h2h':
        renderHeadToHead(panel, matches, state.playerId, names);
        break;
      case 'atc':
        renderAtc(panel, matches, state.playerId);
        break;
    }
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
      tabBar,
      panel,
    ]),
  );
}

// ---- shared building blocks ----

function cell(value: string, label: string): HTMLElement {
  return el('div', { class: 'stat-cell' }, [
    el('div', { class: 'stat-value' }, [value]),
    el('div', { class: 'stat-label' }, [label]),
  ]);
}

function emptyNote(text: string): HTMLElement {
  return el('section', { class: 'card' }, [
    el('p', { class: 'muted center' }, [text]),
  ]);
}

function chartCard(title: string, subtitle?: string): {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
} {
  const canvas = el('canvas', {}) as HTMLCanvasElement;
  const card = el('section', { class: 'card' }, [
    el('h2', { class: 'card-title' }, [title]),
    subtitle ? el('p', { class: 'muted' }, [subtitle]) : null,
    el('div', { class: 'chart-wrap' }, [canvas]),
  ]);
  return { card, canvas };
}

function baseScales(yFrom0 = true) {
  return {
    x: { ticks: { color: TEXT }, grid: { color: GRID } },
    y: { ticks: { color: TEXT }, grid: { color: GRID }, beginAtZero: yFrom0 },
  };
}

function lineChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  datasets: ChartDataset<'line'>[],
  yFrom0 = true,
): void {
  activeCharts.push(
    new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: TEXT } } },
        scales: baseScales(yFrom0),
      },
    }),
  );
}

function barChart(
  canvas: HTMLCanvasElement,
  labels: string[],
  datasets: ChartDataset<'bar'>[],
): void {
  activeCharts.push(
    new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: TEXT } } },
        scales: baseScales(true),
      },
    }),
  );
}

function lineDataset(
  label: string,
  data: number[],
  color: string,
  fill = false,
): ChartDataset<'line'> {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? `${color}33` : color,
    tension: 0.25,
    fill,
    pointRadius: 3,
  };
}

// ---- Overview ----

function renderOverview(panel: HTMLElement, matches: Match[], playerId: string): void {
  const overview = computePlayerOverview(matches, playerId);
  const { card: lineC, canvas: lineCanvas } = chartCard('Average Per Match');
  const { card: barC, canvas: barCanvas } = chartCard('Score Distribution');

  panel.replaceChildren(
    el('section', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        cell(String(overview.matchesPlayed), 'Played'),
        cell(String(overview.matchesWon), 'Won'),
        cell(`${overview.winRate.toFixed(0)}%`, 'Win Rate'),
        cell(overview.overallAverage.toFixed(1), 'Overall Avg'),
        cell(overview.bestMatchAverage.toFixed(1), 'Best Match Avg'),
        cell(String(overview.total180s), '180s'),
        cell(overview.bestCheckout > 0 ? String(overview.bestCheckout) : '—', 'Best Checkout'),
      ]),
    ]),
    lineC,
    barC,
  );

  const avgPoints = averagePerMatch(matches, playerId);
  lineChart(
    lineCanvas,
    avgPoints.map((p) => p.label),
    [lineDataset('3-Dart Avg', avgPoints.map((p) => round(p.average)), ACCENT, true)],
  );

  const dist = scoreDistribution(matches, playerId);
  barChart(barCanvas, dist.labels, [
    { label: 'Visits', data: dist.counts, backgroundColor: GREEN },
  ]);
}

// ---- Consistency ----

function renderConsistency(panel: HTMLElement, matches: Match[], playerId: string): void {
  const s = consistencyStats(matches, playerId);
  if (s.visits === 0) {
    panel.replaceChildren(emptyNote('No scoring visits recorded yet.'));
    return;
  }

  const { card: chartC, canvas } = chartCard(
    'Scoring Spread Per Match',
    'Lower spread (shaded band) means steadier scoring.',
  );

  panel.replaceChildren(
    el('section', { class: 'card' }, [
      el('div', { class: 'rating-line' }, [
        el('span', { class: 'rating-badge' }, [s.rating]),
      ]),
      el('div', { class: 'stat-grid' }, [
        cell(s.averageVisit.toFixed(1), 'Avg Visit'),
        cell(`±${s.stdDev.toFixed(1)}`, 'Std Dev'),
        cell(`${s.coefficientOfVariation.toFixed(0)}%`, 'Variation'),
        cell(String(s.visits), 'Visits'),
      ]),
      el('p', { class: 'muted' }, [
        'Variation normalises spread by skill level — a steady 40-averager and a steady 90-averager can both score low here. Under ~25% is very consistent.',
      ]),
    ]),
    chartC,
  );

  // Average line with a ± std-dev band drawn as two faint bounding lines.
  const labels = s.perMatch.map((p) => p.label);
  const avg = s.perMatch.map((p) => round(p.average));
  const upper = s.perMatch.map((p) => round(p.average + p.stdDev));
  const lower = s.perMatch.map((p) => round(Math.max(0, p.average - p.stdDev)));

  lineChart(canvas, labels, [
    lineDataset('Avg Visit', avg, ACCENT),
    { ...faintBand('Spread +', upper), fill: '+1' },
    { ...faintBand('Spread −', lower) },
  ]);
}

function faintBand(label: string, data: number[]): ChartDataset<'line'> {
  return {
    label,
    data,
    borderColor: 'rgba(233,69,96,0.25)',
    backgroundColor: 'rgba(233,69,96,0.12)',
    borderDash: [4, 4],
    pointRadius: 0,
    tension: 0.25,
    fill: false,
  };
}

// ---- Finishing ----

function renderFinishing(panel: HTMLElement, matches: Match[], playerId: string): void {
  const s = finishingStats(matches, playerId);
  if (s.opportunities === 0) {
    panel.replaceChildren(emptyNote('No checkout opportunities (≤170) recorded yet.'));
    return;
  }

  const { card: lineC, canvas: lineCanvas } = chartCard('Checkout % Per Match');
  const { card: barC, canvas: barCanvas } = chartCard('Checkouts By Finish Size');

  panel.replaceChildren(
    el('section', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        cell(`${s.checkoutPercent.toFixed(0)}%`, 'Checkout %'),
        cell(`${s.checkouts}/${s.opportunities}`, 'Hit / Chances'),
        cell(s.bestCheckout > 0 ? String(s.bestCheckout) : '—', 'Best Checkout'),
        cell(s.averageCheckout > 0 ? s.averageCheckout.toFixed(0) : '—', 'Avg Checkout'),
      ]),
      el('p', { class: 'muted' }, [
        'Checkout % = legs finished ÷ visits that started on a finishable score (≤170).',
      ]),
    ]),
    lineC,
    barC,
  );

  lineChart(
    lineCanvas,
    s.perMatch.map((p) => p.label),
    [lineDataset('Checkout %', s.perMatch.map((p) => round(p.checkoutPercent)), GREEN, true)],
  );

  barChart(barCanvas, s.bands.labels, [
    { label: 'Checkouts', data: s.bands.counts, backgroundColor: AMBER },
  ]);
}

// ---- Scoring power ----

function renderScoring(panel: HTMLElement, matches: Match[], playerId: string): void {
  const s = scoringStats(matches, playerId);
  if (s.threeDartAverage === 0) {
    panel.replaceChildren(emptyNote('No scoring data recorded yet.'));
    return;
  }

  const { card: lineC, canvas: lineCanvas } = chartCard(
    '3-Dart vs First-9 Average',
    'First-9 is the pure scoring phase before finishing.',
  );

  panel.replaceChildren(
    el('section', { class: 'card' }, [
      el('div', { class: 'stat-grid' }, [
        cell(s.threeDartAverage.toFixed(1), '3-Dart Avg'),
        cell(s.firstNineAverage.toFixed(1), 'First-9 Avg'),
        cell(`${s.tonPlusRate.toFixed(0)}%`, 'Ton+ Rate'),
        cell(String(s.highestVisit), 'Best Visit'),
        cell(String(s.over100), '100+'),
        cell(String(s.over140), '140+'),
        cell(String(s.over180), '180s'),
      ]),
      el('p', { class: 'muted' }, [
        'Ton+ rate = share of scoring visits worth 100 or more.',
      ]),
    ]),
    lineC,
  );

  lineChart(
    lineCanvas,
    s.perMatch.map((p) => p.label),
    [
      lineDataset('3-Dart Avg', s.perMatch.map((p) => round(p.average)), ACCENT),
      lineDataset('First-9 Avg', s.perMatch.map((p) => round(p.firstNine)), BLUE),
    ],
  );
}

// ---- Head-to-head ----

function renderHeadToHead(
  panel: HTMLElement,
  matches: Match[],
  playerId: string,
  names: Map<string, string>,
): void {
  const rows = headToHead(matches, playerId);
  if (rows.length === 0) {
    panel.replaceChildren(
      emptyNote('No completed 1-v-1 matches yet. Head-to-head needs two-player games.'),
    );
    return;
  }

  const table = el('table', { class: 'h2h-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Opponent']),
        el('th', { class: 'num' }, ['W–L']),
        el('th', { class: 'num' }, ['Win %']),
        el('th', { class: 'num' }, ['Legs']),
        el('th', { class: 'num' }, ['Avg']),
        el('th', { class: 'num' }, ['Opp Avg']),
      ]),
    ]),
    el(
      'tbody',
      {},
      rows.map((r) =>
        el('tr', {}, [
          el('td', {}, [names.get(r.opponentId) ?? 'Unknown']),
          el('td', { class: 'num' }, [`${r.won}–${r.lost}`]),
          el('td', { class: `num ${r.winRate >= 50 ? 'good' : 'bad'}` }, [
            `${r.winRate.toFixed(0)}%`,
          ]),
          el('td', { class: 'num' }, [`${r.legsFor}–${r.legsAgainst}`]),
          el('td', { class: 'num' }, [r.avgFor.toFixed(1)]),
          el('td', { class: 'num' }, [r.avgAgainst.toFixed(1)]),
        ]),
      ),
    ),
  ]);

  panel.replaceChildren(
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, ['Record vs Opponents']),
      el('p', { class: 'muted' }, ['1-v-1 matches only. "Avg" columns compare 3-dart averages in those games.']),
      table,
    ]),
  );
}

// ---- Around the Clock (split by ring/variant) ----

function renderAtc(panel: HTMLElement, matches: Match[], playerId: string): void {
  const variants = atcStatsByVariant(matches, playerId);
  if (variants.length === 0) {
    panel.replaceChildren(emptyNote('No completed Around the Clock matches yet.'));
    return;
  }

  const variantCards = variants.map((v) =>
    el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, [
        el('span', { class: 'ring-dot', style: `background:${RING_COLORS[v.ring]}` }),
        ` ${atcRingLabel(v.ring)}`,
      ]),
      el('div', { class: 'stat-grid' }, [
        cell(String(v.played), 'Played'),
        cell(`${v.winRate.toFixed(0)}%`, 'Win Rate'),
        cell(`${v.hitRate.toFixed(0)}%`, 'Hit Rate'),
        cell(v.fewestToClear > 0 ? String(v.fewestToClear) : '—', 'Fewest Darts'),
        cell(v.avgDartsToClear > 0 ? v.avgDartsToClear.toFixed(0) : '—', 'Avg Darts'),
      ]),
    ]),
  );

  const points = atcPerMatch(matches, playerId);
  const { card: hitC, canvas: hitCanvas } = chartCard(
    'Hit % Over Time',
    'One line per variant — gaps where that variant wasn’t played.',
  );
  const { card: dartsC, canvas: dartsCanvas } = chartCard(
    'Avg Darts to Clear',
    'Average darts to clear a leg, by variant (lower is better).',
  );

  panel.replaceChildren(...variantCards, hitC, dartsC);

  // Hit % over time: aligned to all ATC matches, one dataset per variant.
  const labels = points.map((p) => p.label);
  const hitDatasets: ChartDataset<'line'>[] = variants.map((v) => ({
    label: atcRingLabel(v.ring),
    data: points.map((p) => (p.ring === v.ring ? round(p.hitRate) : null)),
    borderColor: RING_COLORS[v.ring],
    backgroundColor: RING_COLORS[v.ring],
    spanGaps: true,
    tension: 0.25,
    pointRadius: 3,
  }));
  lineChart(hitCanvas, labels, hitDatasets);

  barChart(
    dartsCanvas,
    variants.map((v) => atcRingLabel(v.ring)),
    [
      {
        label: 'Avg darts to clear',
        data: variants.map((v) => round(v.avgDartsToClear)),
        backgroundColor: variants.map((v) => RING_COLORS[v.ring]),
      },
    ],
  );
}

function round(n: number): number {
  return Number(n.toFixed(1));
}
