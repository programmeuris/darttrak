import { useEffect, useRef, useState, type ReactNode } from 'react';
import 'chart.js/auto';
import { Line, Bar } from 'react-chartjs-2';
import type { ChartData, ChartDataset, ChartOptions, TooltipItem } from 'chart.js';
import { navigate } from '../router';
import { Header, StatCell } from '../components/Header';
import { getPlayers, getAllMatches } from '../db';
import { computePlayerOverview, averagePerMatch, scoreDistribution } from '../stats';
import { consistencyStats, finishingStats, scoringStats, headToHead } from '../analysis';
import { atcStatsByVariant, atcSeriesByVariant, atcRingLabel } from '../atc';
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

const round = (n: number) => Number(n.toFixed(1));

function axes(yFrom0 = true) {
  return {
    x: { ticks: { color: TEXT }, grid: { color: GRID } },
    y: { ticks: { color: TEXT }, grid: { color: GRID }, beginAtZero: yFrom0 },
  };
}
const lineOpts: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: TEXT } } },
  scales: axes(true),
};
const barOpts: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: TEXT } } },
  scales: axes(true),
};

function line(label: string, data: (number | null)[], color: string, fill = false): ChartDataset<'line'> {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? `${color}33` : color,
    tension: 0.25,
    fill,
    pointRadius: 3,
    spanGaps: true,
  };
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      {subtitle && <p className="muted">{subtitle}</p>}
      <div className="chart-wrap">{children}</div>
    </section>
  );
}

function Grid({ cells }: { cells: [string, string][] }) {
  return (
    <div className="stat-grid">
      {cells.map(([value, label], i) => (
        <StatCell key={i} value={value} label={label} />
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <section className="card">
      <p className="muted center">{text}</p>
    </section>
  );
}

// The nav has two levels: a top row of game modes, and — under the x01 mode — a
// sub-row of analytical lenses. ATC is its own mode with its own internal views.
type X01Lens = 'overview' | 'consistency' | 'finishing' | 'scoring' | 'h2h';
type StatsMode = 'x01' | 'atc';
type TabId = X01Lens | 'atc'; // the active leaf view (an x01 lens, or atc)

const MODES: { id: StatsMode; label: string }[] = [
  { id: 'x01', label: 'x01' },
  { id: 'atc', label: 'Around the Clock' },
];
const X01_TABS: { id: X01Lens; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'consistency', label: 'Consistency' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'h2h', label: 'Head-to-Head' },
];

// Remember the last-open tab per player (a per-device UI preference, so it lives
// in localStorage rather than the player/data model). Falls back to overview.
const TAB_IDS = new Set<string>([...X01_TABS.map((t) => t.id), 'atc']);
const tabStorageKey = (playerId: string) => `darttrak:statsTab:${playerId}`;

function readStoredTab(playerId: string): TabId {
  try {
    const v = localStorage.getItem(tabStorageKey(playerId));
    if (v && TAB_IDS.has(v)) return v as TabId;
  } catch {
    // localStorage can be unavailable (private mode); fall back silently.
  }
  return 'overview';
}

function writeStoredTab(playerId: string, tab: TabId): void {
  try {
    localStorage.setItem(tabStorageKey(playerId), tab);
  } catch {
    // ignore write failures
  }
}

// When `playerId` is passed (from a player profile) the screen locks to that
// player and hides the picker; without it, it keeps the standalone dropdown.
export function PlayerStats({ playerId: lockedId }: { playerId?: string } = {}) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedId, setSelectedId] = useState('');
  // Locked player is known on mount, so seed from storage to avoid a flash;
  // the global view seeds once the player resolves (effect below).
  const [tab, setTab] = useState<TabId>(() => (lockedId ? readStoredTab(lockedId) : 'overview'));

  useEffect(() => {
    Promise.all([getPlayers(), getAllMatches()]).then(([ps, ms]) => {
      setPlayers(ps);
      setMatches(ms);
      if (!lockedId && ps.length) setSelectedId(ps[0].id);
    });
  }, [lockedId]);

  const playerId = lockedId ?? selectedId;

  // Restore the remembered tab whenever the active player changes (including the
  // dropdown switching players on the global view).
  useEffect(() => {
    if (playerId) setTab(readStoredTab(playerId));
  }, [playerId]);

  function selectTab(t: TabId) {
    setTab(t);
    if (playerId) writeStoredTab(playerId, t);
  }

  // Active top-level mode, plus the last x01 lens so switching x01 ← ATC returns
  // to the lens you were on rather than always resetting to Overview.
  const mode: StatsMode = tab === 'atc' ? 'atc' : 'x01';
  const lastX01Lens = useRef<X01Lens>('overview');
  useEffect(() => {
    if (tab !== 'atc') lastX01Lens.current = tab;
  }, [tab]);
  const selectMode = (m: StatsMode) => selectTab(m === 'atc' ? 'atc' : lastX01Lens.current);
  const names = new Map(players.map((p) => [p.id, p.name]));
  const onBack = () => navigate(lockedId ? `/player/${lockedId}` : '/');

  if (players.length === 0) {
    return (
      <div className="screen">
        <Header title="Player Stats" onBack={onBack} />
        <p className="muted center">Add players to see stats.</p>
      </div>
    );
  }

  const title = lockedId ? `${names.get(lockedId) ?? 'Player'} · Stats` : 'Player Stats';

  return (
    <div className="screen">
      <Header title={title} onBack={onBack} />
      {!lockedId && (
        <section className="card">
          <label className="field-label">Player</label>
          <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {players.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </section>
      )}

      <div className="tab-bar">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`tab ${mode === m.id ? 'active' : ''}`}
            onClick={() => selectMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'x01' && (
        <div className="tab-bar tab-bar-sub">
          {X01_TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${t.id === tab ? 'active' : ''}`}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="stats-panel">
        {tab === 'overview' && <Overview matches={matches} playerId={playerId} />}
        {tab === 'consistency' && <Consistency matches={matches} playerId={playerId} />}
        {tab === 'finishing' && <Finishing matches={matches} playerId={playerId} />}
        {tab === 'scoring' && <Scoring matches={matches} playerId={playerId} />}
        {tab === 'h2h' && <HeadToHead matches={matches} playerId={playerId} names={names} />}
        {tab === 'atc' && <Atc matches={matches} playerId={playerId} />}
      </div>
    </div>
  );
}

function Overview({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const o = computePlayerOverview(matches, playerId);
  const avg = averagePerMatch(matches, playerId);
  const dist = scoreDistribution(matches, playerId);
  // X-axis is the match number (1, 2, …); the date moves into the tooltip so
  // same-day games don't collapse onto a repeated label.
  const lineData: ChartData<'line'> = {
    labels: avg.map((_, i) => `Match ${i + 1}`),
    datasets: [line('3-Dart Avg', avg.map((p) => round(p.average)), ACCENT, true)],
  };
  const avgOpts: ChartOptions<'line'> = {
    ...lineOpts,
    plugins: {
      ...lineOpts.plugins,
      tooltip: {
        callbacks: { title: (items: TooltipItem<'line'>[]) => avg[items[0]?.dataIndex ?? 0]?.label ?? '' },
      },
    },
  };
  const barData: ChartData<'bar'> = {
    labels: dist.labels,
    datasets: [{ label: 'Visits', data: dist.counts, backgroundColor: GREEN }],
  };
  return (
    <>
      <section className="card">
        <Grid
          cells={[
            [String(o.competitivePlayed), `Played (${o.matchesPlayed} total)`],
            [String(o.matchesWon), 'Won'],
            [o.competitivePlayed === 0 ? '—' : `${o.winRate.toFixed(0)}%`, 'Win Rate'],
            [o.overallAverage.toFixed(1), 'Overall Avg'],
            [o.bestMatchAverage.toFixed(1), 'Best Match Avg'],
            [String(o.total180s), '180s'],
            [o.bestCheckout > 0 ? String(o.bestCheckout) : '—', 'Best Checkout'],
          ]}
        />
        <p className="muted">Win rate counts competitive games only (excludes solo practice).</p>
      </section>
      <ChartCard title="Average Per Match">
        <Line data={lineData} options={avgOpts} />
      </ChartCard>
      <ChartCard title="Score Distribution">
        <Bar data={barData} options={barOpts} />
      </ChartCard>
    </>
  );
}

function Consistency({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const s = consistencyStats(matches, playerId);
  if (s.visits === 0) return <Empty text="No scoring visits recorded yet." />;
  const labels = s.perMatch.map((p) => p.label);
  const data: ChartData<'line'> = {
    labels,
    datasets: [
      line('Avg Visit', s.perMatch.map((p) => round(p.average)), ACCENT),
      {
        ...line('Spread +', s.perMatch.map((p) => round(p.average + p.stdDev)), 'rgba(233,69,96,0.25)'),
        borderDash: [4, 4],
        pointRadius: 0,
        fill: '+1',
      },
      {
        ...line('Spread −', s.perMatch.map((p) => round(Math.max(0, p.average - p.stdDev))), 'rgba(233,69,96,0.25)'),
        borderDash: [4, 4],
        pointRadius: 0,
      },
    ],
  };
  return (
    <>
      <section className="card">
        <div className="rating-line">
          <span className="rating-badge">{s.rating}</span>
        </div>
        <Grid
          cells={[
            [s.averageVisit.toFixed(1), 'Avg Visit'],
            [`±${s.stdDev.toFixed(1)}`, 'Std Dev'],
            [`${s.coefficientOfVariation.toFixed(0)}%`, 'Variation'],
            [String(s.visits), 'Visits'],
          ]}
        />
        <p className="muted">
          Variation normalises spread by skill level — under ~25% is very consistent.
        </p>
      </section>
      <ChartCard title="Scoring Spread Per Match" subtitle="Lower spread (shaded band) means steadier scoring.">
        <Line data={data} options={lineOpts} />
      </ChartCard>
    </>
  );
}

function Finishing({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const s = finishingStats(matches, playerId);
  if (s.opportunities === 0) return <Empty text="No checkout opportunities (≤170) recorded yet." />;
  const lineData: ChartData<'line'> = {
    labels: s.perMatch.map((p) => p.label),
    datasets: [line('Checkout %', s.perMatch.map((p) => round(p.checkoutPercent)), GREEN, true)],
  };
  const barData: ChartData<'bar'> = {
    labels: s.bands.labels,
    datasets: [{ label: 'Checkouts', data: s.bands.counts, backgroundColor: AMBER }],
  };
  return (
    <>
      <section className="card">
        <Grid
          cells={[
            [`${s.checkoutPercent.toFixed(0)}%`, 'Checkout %'],
            [`${s.checkouts}/${s.opportunities}`, 'Hit / Chances'],
            [s.bestCheckout > 0 ? String(s.bestCheckout) : '—', 'Best Checkout'],
            [s.averageCheckout > 0 ? s.averageCheckout.toFixed(0) : '—', 'Avg Checkout'],
          ]}
        />
        <p className="muted">Checkout % = legs finished ÷ visits that started ≤170.</p>
      </section>
      <ChartCard title="Checkout % Per Match">
        <Line data={lineData} options={lineOpts} />
      </ChartCard>
      <ChartCard title="Checkouts By Finish Size">
        <Bar data={barData} options={barOpts} />
      </ChartCard>
    </>
  );
}

function Scoring({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const s = scoringStats(matches, playerId);
  if (s.threeDartAverage === 0) return <Empty text="No scoring data recorded yet." />;
  const data: ChartData<'line'> = {
    labels: s.perMatch.map((p) => p.label),
    datasets: [
      line('3-Dart Avg', s.perMatch.map((p) => round(p.average)), ACCENT),
      line('First-9 Avg', s.perMatch.map((p) => round(p.firstNine)), BLUE),
    ],
  };
  return (
    <>
      <section className="card">
        <Grid
          cells={[
            [s.threeDartAverage.toFixed(1), '3-Dart Avg'],
            [s.firstNineAverage.toFixed(1), 'First-9 Avg'],
            [`${s.tonPlusRate.toFixed(0)}%`, 'Ton+ Rate'],
            [String(s.highestVisit), 'Best Visit'],
            [String(s.over100), '100+'],
            [String(s.over140), '140+'],
            [String(s.over180), '180s'],
          ]}
        />
        <p className="muted">Ton+ rate = share of scoring visits worth 100 or more.</p>
      </section>
      <ChartCard title="3-Dart vs First-9 Average" subtitle="First-9 is the pure scoring phase before finishing.">
        <Line data={data} options={lineOpts} />
      </ChartCard>
    </>
  );
}

function HeadToHead({ matches, playerId, names }: { matches: Match[]; playerId: string; names: Map<string, string> }) {
  const rows = headToHead(matches, playerId);
  if (rows.length === 0) return <Empty text="No completed 1-v-1 matches yet. Head-to-head needs two-player games." />;
  return (
    <section className="card">
      <h2 className="card-title">Record vs Opponents</h2>
      <p className="muted">1-v-1 matches only. "Avg" columns compare 3-dart averages in those games.</p>
      <table className="h2h-table">
        <thead>
          <tr>
            <th>Opponent</th>
            <th className="num">W–L</th>
            <th className="num">Win %</th>
            <th className="num">Legs</th>
            <th className="num">Avg</th>
            <th className="num">Opp Avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.opponentId}>
              <td>{names.get(r.opponentId) ?? 'Unknown'}</td>
              <td className="num">
                {r.won}–{r.lost}
              </td>
              <td className={`num ${r.winRate >= 50 ? 'good' : 'bad'}`}>{r.winRate.toFixed(0)}%</td>
              <td className="num">
                {r.legsFor}–{r.legsAgainst}
              </td>
              <td className="num">{r.avgFor.toFixed(1)}</td>
              <td className="num">{r.avgAgainst.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Atc({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const [metric, setMetric] = useState<'hit' | 'darts'>('hit');
  const variants = atcStatsByVariant(matches, playerId);
  if (variants.length === 0) return <Empty text="No completed Around the Clock matches yet." />;
  const isHit = metric === 'hit';
  // Each variant is indexed by its own game count so they align at game 1,
  // rather than sharing a date axis where same-day / cross-variant games collide.
  const series = atcSeriesByVariant(matches, playerId);
  const maxGames = Math.max(0, ...series.map((s) => s.points.length));
  const lineData: ChartData<'line'> = {
    labels: Array.from({ length: maxGames }, (_, i) => `Game ${i + 1}`),
    datasets: series.map((s) => ({
      label: atcRingLabel(s.ring),
      data: s.points.map((p) => (isHit ? round(p.hitRate) : p.darts)),
      borderColor: RING_COLORS[s.ring],
      backgroundColor: RING_COLORS[s.ring],
      tension: 0.25,
      pointRadius: 3,
    })),
  };
  const lineOptsMetric: ChartOptions<'line'> = {
    ...lineOpts,
    plugins: {
      ...lineOpts.plugins,
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'line'>) => {
            const pt = series[ctx.datasetIndex]?.points[ctx.dataIndex];
            const value = isHit ? `${ctx.parsed.y}%` : `${ctx.parsed.y} darts`;
            return `${ctx.dataset.label}: ${value}${pt ? ` · ${pt.label}` : ''}`;
          },
        },
      },
    },
  };
  const dartsData: ChartData<'bar'> = {
    labels: variants.map((v) => atcRingLabel(v.ring)),
    datasets: [
      {
        label: 'Avg darts to clear',
        data: variants.map((v) => round(v.avgDartsToClear)),
        backgroundColor: variants.map((v) => RING_COLORS[v.ring]),
      },
    ],
  };
  return (
    <>
      {variants.map((v) => (
        <section className="card" key={v.ring}>
          <h2 className="card-title">
            <span className="ring-dot" style={{ background: RING_COLORS[v.ring] }} /> {atcRingLabel(v.ring)}
          </h2>
          <Grid
            cells={[
              [String(v.competitivePlayed), `Played (${v.played} total)`],
              [v.competitivePlayed === 0 ? '—' : `${v.winRate.toFixed(0)}%`, 'Win Rate'],
              [`${v.hitRate.toFixed(0)}%`, 'Hit Rate'],
              [v.fewestToClear > 0 ? String(v.fewestToClear) : '—', 'Fewest Darts'],
              [v.avgDartsToClear > 0 ? v.avgDartsToClear.toFixed(0) : '—', 'Avg Darts'],
            ]}
          />
        </section>
      ))}
      <section className="card">
        <h2 className="card-title">{isHit ? 'Hit % by Game' : 'Darts by Game'}</h2>
        <p className="muted">One line per variant, each indexed by its own game count.</p>
        <div className="chip-row">
          <button className={`chip ${isHit ? 'active' : ''}`} onClick={() => setMetric('hit')}>
            Hit %
          </button>
          <button className={`chip ${!isHit ? 'active' : ''}`} onClick={() => setMetric('darts')}>
            Darts / game
          </button>
        </div>
        <div className="chart-wrap">
          <Line data={lineData} options={lineOptsMetric} />
        </div>
      </section>
      <ChartCard title="Avg Darts to Clear" subtitle="Average darts to clear a leg, by variant (lower is better).">
        <Bar data={dartsData} options={barOpts} />
      </ChartCard>
    </>
  );
}
