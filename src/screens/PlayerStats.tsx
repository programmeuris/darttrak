import { useEffect, useRef, useState, type ReactNode } from 'react';
import 'chart.js/auto';
import { Line, Bar } from 'react-chartjs-2';
import type { ChartData, ChartDataset, ChartOptions, TooltipItem } from 'chart.js';
import { navigate } from '../router';
import { toast } from '../toast';
import { readMainPlayer, readPref, writePref } from '../prefs';
import { Header, StatCell } from '../components/Header';
import { getPlayers, getAllMatches } from '../db';
import { computePlayerOverview, averagePerMatch, scoreDistribution, x01PersonalBests } from '../stats';
import { consistencyStats, finishingStats, scoringStats, headToHead } from '../analysis';
import { rollingMean, trendDelta, type TrendDelta } from '../progression';
import {
  ATC_RING_ORDER,
  atcStatsByVariant,
  atcSeriesByVariant,
  atcTargetStats,
  atcTargetTrends,
  atcPersonalBests,
  atcVariantMatches,
  atcRingLabel,
} from '../atc';
import type { AtcTargetStat } from '../atc';
import {
  trainingRounds,
  trainingBestRound,
  trainingFieldStats,
  trainingFieldLabel,
} from '../training';
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
const shortDate = (d: number) => new Date(d).toLocaleDateString();

// Trailing window for the smoothed trend line overlaid on the raw series.
const ROLLING_WINDOW = 5;

// Cap and keep the x labels horizontal: rendering every "Match N"/"Leg N"
// label rotates them diagonally and eats the bottom quarter of an
// already-small phone chart. The tooltip still identifies every point.
const X_TICKS = { color: TEXT, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 };

function axes(yFrom0 = true) {
  return {
    x: { ticks: X_TICKS, grid: { color: GRID } },
    y: { ticks: { color: TEXT }, grid: { color: GRID }, beginAtZero: yFrom0 },
  };
}

// Raw-series points shrink once the series is long enough that full-size
// points would smear into a solid band.
const pointSize = (n: number) => (n > 30 ? 2 : 3);
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

// Options for per-match trend charts whose x-axis is the match number
// ("Match 1", "Match 2", …): the date moves into the tooltip title, so
// same-day games don't collapse onto a repeated axis label.
function matchIndexOpts(points: { label: string }[]): ChartOptions<'line'> {
  return {
    ...lineOpts,
    plugins: {
      ...lineOpts.plugins,
      tooltip: {
        callbacks: {
          title: (items: TooltipItem<'line'>[]) => points[items[0]?.dataIndex ?? 0]?.label ?? '',
        },
      },
    },
  };
}

// Dual-axis progression chart (ATC per-leg, Training per-round): a hit % on
// the left axis (0–100), a darts figure on the right axis (auto-scaled), so
// both trends read off one graph.
function atcVariantOpts(
  points: { label: string; cleared: boolean }[],
  dartsTitle = 'Darts / leg',
): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      // Dataset `order` flips the legend and tooltip listing along with the
      // draw order, so both are pinned back to dataset order (Hit % first).
      // The rolling-average overlays are hidden from the legend — four
      // entries is clutter; they're self-explanatory in the tooltip.
      legend: {
        labels: {
          color: TEXT,
          sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
          filter: (item) => !(item.text ?? '').includes('avg'),
        },
      },
      tooltip: {
        itemSort: (a: TooltipItem<'line'>, b: TooltipItem<'line'>) =>
          a.datasetIndex - b.datasetIndex,
        callbacks: {
          title: (items: TooltipItem<'line'>[]) => points[items[0]?.dataIndex ?? 0]?.label ?? '',
          label: (ctx: TooltipItem<'line'>) => {
            const isDarts = ctx.dataset.yAxisID === 'yDarts';
            // An uncleared game ended before the player finished the board, so
            // its darts count is truncated — flag it rather than let it read
            // as a genuinely quick game. Raw series only: the rolling average
            // already excludes uncleared legs.
            const suffix =
              ctx.dataset.label === 'Darts / leg' && !points[ctx.dataIndex]?.cleared
                ? ' (unfinished)'
                : '';
            return `${ctx.dataset.label}: ${ctx.parsed.y}${isDarts ? ' darts' : '%'}${suffix}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: X_TICKS, grid: { color: GRID } },
      y: {
        type: 'linear',
        position: 'left',
        min: 0,
        max: 100,
        ticks: { color: TEXT, callback: (v: number | string) => `${v}%` },
        grid: { color: GRID },
        title: { display: true, text: 'Hit %', color: TEXT },
      },
      yDarts: {
        type: 'linear',
        position: 'right',
        ticks: { color: TEXT },
        grid: { drawOnChartArea: false },
        title: { display: true, text: dartsTitle, color: TEXT },
      },
    },
  };
}

function line(label: string, data: (number | null)[], color: string, fill = false): ChartDataset<'line'> {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? `${color}33` : color,
    tension: 0.25,
    fill,
    pointRadius: pointSize(data.length),
    spanGaps: true,
  };
}

// Smoothed companion to a raw series. One styling rule across every chart:
// the metric's colour is shared, raw data is a solid line with points, the
// rolling average is DOTTED, point-free, and drawn in front of the raw lines
// (lower `order` draws on top), starting once a full window exists.
function rollingLine(
  label: string,
  data: (number | null)[],
  color: string,
  yAxisID?: string,
): ChartDataset<'line'> {
  return {
    label,
    data: data.map((v) => (v === null ? null : round(v))),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 3,
    borderDash: [3, 5],
    pointRadius: 0,
    tension: 0.35,
    spanGaps: true,
    order: 1,
    ...(yAxisID ? { yAxisID } : {}),
  };
}

// One cell of the "recent window vs the window before" comparison.
function TrendCell({
  label,
  trend,
  goodWhen,
  unit = '',
}: {
  label: string;
  trend: TrendDelta | null;
  goodWhen: 'up' | 'down';
  unit?: string;
}) {
  if (!trend) return <StatCell value="—" label={`${label} trend`} />;
  const d = round(trend.delta);
  const cls = d === 0 ? '' : (goodWhen === 'up' ? d > 0 : d < 0) ? 'good' : 'bad';
  return (
    <div className="stat-cell">
      <div className={`stat-value ${cls}`}>{`${d > 0 ? '+' : ''}${d.toFixed(1)}${unit}`}</div>
      <div className="stat-label">
        {label} · last {trend.window} vs prev {trend.window}
      </div>
    </div>
  );
}

/**
 * Chart container with a corner button that reopens the same chart in a
 * fullscreen overlay — inline charts are cramped on a phone, and rotating to
 * landscape gives the expanded view several times the plot area. The children
 * are rendered twice (a second chart instance), so data and options carry
 * over unchanged.
 */
function ExpandableChart({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Same focus contract as the delete dialog: move focus in while open,
  // return it to the expand button on close.
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
    } else {
      restoreRef.current?.focus();
      restoreRef.current = null;
    }
  }, [open]);

  return (
    <>
      <div className="chart-wrap">
        {children}
        <button
          type="button"
          className="chart-expand-btn"
          aria-label={`Expand ${title} chart`}
          onClick={() => setOpen(true)}
        >
          ⛶
        </button>
      </div>
      {open && (
        <div
          className="chart-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} chart`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            // The close button is the only focusable control — keep Tab on it.
            if (e.key === 'Tab') e.preventDefault();
          }}
        >
          <div className="chart-lightbox-bar">
            <span className="chart-lightbox-title">{title}</span>
            <button
              ref={closeRef}
              type="button"
              className="icon-btn"
              aria-label="Close chart"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="chart-lightbox-body">{children}</div>
        </div>
      )}
    </>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      {subtitle && <p className="muted">{subtitle}</p>}
      <ExpandableChart title={title}>{children}</ExpandableChart>
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
type StatsMode = 'x01' | 'atc' | 'training';
type TabId = X01Lens | 'atc' | 'training'; // the active leaf view

const MODES: { id: StatsMode; label: string }[] = [
  { id: 'x01', label: 'x01' },
  { id: 'atc', label: 'Around the Clock' },
  { id: 'training', label: 'Training' },
];
const X01_TABS: { id: X01Lens; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'consistency', label: 'Consistency' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'h2h', label: 'Head-to-Head' },
];

// Remember the last-open tab per player. Falls back to overview.
const TAB_IDS = new Set<string>([...X01_TABS.map((t) => t.id), 'atc', 'training']);

function readStoredTab(playerId: string): TabId {
  const v = readPref(`statsTab:${playerId}`);
  return v && TAB_IDS.has(v) ? (v as TabId) : 'overview';
}

function writeStoredTab(playerId: string, tab: TabId): void {
  writePref(`statsTab:${playerId}`, tab);
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
    Promise.all([getPlayers(), getAllMatches()])
      .then(([ps, ms]) => {
        setPlayers(ps);
        setMatches(ms);
        // Default the picker to the device's main player when one is set.
        const main = readMainPlayer();
        if (!lockedId && ps.length) {
          setSelectedId(main && ps.some((p) => p.id === main) ? main : ps[0].id);
        }
      })
      .catch((err) => {
        console.error(err);
        toast('Failed to load stats', 'error');
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

  // Active top-level mode, plus the last x01 lens so switching back to x01
  // returns to the lens you were on rather than always resetting to Overview.
  const mode: StatsMode = tab === 'atc' || tab === 'training' ? tab : 'x01';
  const lastX01Lens = useRef<X01Lens>('overview');
  useEffect(() => {
    if (tab !== 'atc' && tab !== 'training') lastX01Lens.current = tab;
  }, [tab]);
  const selectMode = (m: StatsMode) => selectTab(m === 'x01' ? lastX01Lens.current : m);
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
            aria-pressed={mode === m.id}
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
              aria-pressed={t.id === tab}
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
        {tab === 'atc' && <Atc key={playerId} matches={matches} playerId={playerId} />}
        {tab === 'training' && <Training key={playerId} matches={matches} playerId={playerId} />}
      </div>
    </div>
  );
}

function Overview({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const o = computePlayerOverview(matches, playerId);
  const avg = averagePerMatch(matches, playerId);
  const dist = scoreDistribution(matches, playerId);
  const pb = x01PersonalBests(matches, playerId);
  const avgTrend = trendDelta(avg.map((p) => p.average));
  const checkoutTrend = trendDelta(
    finishingStats(matches, playerId).perMatch.map((p) => p.checkoutPercent),
  );
  const avgValues = avg.map((p) => p.average);
  const lineData: ChartData<'line'> = {
    labels: avg.map((_, i) => `Match ${i + 1}`),
    datasets: [
      // Explicit order keeps the raw line beneath the dotted rolling average
      // (lower order draws on top).
      { ...line('3-Dart Avg', avg.map((p) => round(p.average)), ACCENT, true), order: 2 },
      ...(avg.length >= ROLLING_WINDOW
        ? [
            rollingLine(
              `${ROLLING_WINDOW}-match avg`,
              rollingMean(avgValues, ROLLING_WINDOW),
              ACCENT,
            ),
          ]
        : []),
    ],
  };
  const barData: ChartData<'bar'> = {
    labels: dist.labels,
    datasets: [{ label: 'Visits', data: dist.counts, backgroundColor: GREEN }],
  };
  // Personal-best cells carry the date the record was set — a cluster of
  // recent dates is itself a progression signal.
  const withDate = (label: string, best: { date: number } | null) =>
    best ? `${label} · ${shortDate(best.date)}` : label;
  return (
    <>
      <section className="card">
        <Grid
          cells={[
            [String(o.competitivePlayed), `Played (${o.matchesPlayed} total)`],
            [String(o.matchesWon), 'Won'],
            [o.competitivePlayed === 0 ? '—' : `${o.winRate.toFixed(0)}%`, 'Win Rate'],
            [o.overallAverage.toFixed(1), 'Overall Avg'],
            [
              o.bestMatchAverage.toFixed(1),
              withDate('Best Match Avg', pb.bestMatchAverage),
            ],
            [String(o.total180s), '180s'],
            [
              o.bestCheckout > 0 ? String(o.bestCheckout) : '—',
              withDate('Best Checkout', pb.bestCheckout),
            ],
            [
              pb.fewestDartsLeg ? String(pb.fewestDartsLeg.value) : '—',
              withDate('Fastest Leg (darts)', pb.fewestDartsLeg),
            ],
            [
              pb.highestTurn ? String(pb.highestTurn.value) : '—',
              withDate('Best Visit', pb.highestTurn),
            ],
          ]}
        />
        <p className="muted">Win rate counts competitive games only (excludes solo practice).</p>
      </section>
      {(avgTrend || checkoutTrend) && (
        <section className="card">
          <h2 className="card-title">Trend</h2>
          <div className="stat-grid">
            <TrendCell label="3-Dart Avg" trend={avgTrend} goodWhen="up" />
            <TrendCell label="Checkout %" trend={checkoutTrend} goodWhen="up" unit="%" />
          </div>
          <p className="muted">
            Your most recent matches against the ones before them — green means improving.
          </p>
        </section>
      )}
      <ChartCard
        title="Average Per Match"
        subtitle={
          avg.length >= ROLLING_WINDOW
            ? `The dotted line is the ${ROLLING_WINDOW}-match rolling average — your form through the noise.`
            : undefined
        }
      >
        <Line data={lineData} options={matchIndexOpts(avg)} />
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
  const data: ChartData<'line'> = {
    labels: s.perMatch.map((_, i) => `Match ${i + 1}`),
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
        <Line data={data} options={matchIndexOpts(s.perMatch)} />
      </ChartCard>
    </>
  );
}

function Finishing({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const s = finishingStats(matches, playerId);
  if (s.opportunities === 0) return <Empty text="No checkout opportunities recorded yet." />;
  const lineData: ChartData<'line'> = {
    labels: s.perMatch.map((_, i) => `Match ${i + 1}`),
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
        <p className="muted">
          Checkout % = legs finished ÷ visits that started in checkout range (≤170 double-out,
          ≤180 straight-out).
        </p>
      </section>
      <ChartCard title="Checkout % Per Match">
        <Line data={lineData} options={matchIndexOpts(s.perMatch)} />
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
    labels: s.perMatch.map((_, i) => `Match ${i + 1}`),
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
        <p className="muted">Ton+ rate = share of visits worth 100 or more (busts excluded).</p>
      </section>
      <ChartCard title="3-Dart vs First-9 Average" subtitle="First-9 is the pure scoring phase before finishing.">
        <Line data={data} options={matchIndexOpts(s.perMatch)} />
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

// How many recent games the "Last N" scope keeps; the toggle only appears once a
// variant has more games than this.
const ATC_RECENT_WINDOW = 20;

const RING_IDS = new Set<string>(ATC_RING_ORDER);

function Atc({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const variants = atcStatsByVariant(matches, playerId);
  // The variant and scope toggles are remembered per player, like the tab.
  // Initializers run once per mount — the component is keyed by playerId, so
  // switching players re-reads that player's preferences.
  const [activeRing, setActiveRing] = useState<AtcRing | null>(() => {
    const v = readPref(`atcRing:${playerId}`);
    return v && RING_IDS.has(v) ? (v as AtcRing) : null;
  });
  const [soloOnly, setSoloOnly] = useState(() => readPref(`atcSolo:${playerId}`) === '1');
  const [recentOnly, setRecentOnly] = useState(() => readPref(`atcRecent:${playerId}`) === '1');
  if (variants.length === 0) return <Empty text="No completed Around the Clock matches yet." />;

  const selectRing = (r: AtcRing) => {
    setActiveRing(r);
    writePref(`atcRing:${playerId}`, r);
  };
  const selectSolo = (v: boolean) => {
    setSoloOnly(v);
    writePref(`atcSolo:${playerId}`, v ? '1' : '0');
  };
  const selectRecent = (v: boolean) => {
    setRecentOnly(v);
    writePref(`atcRecent:${playerId}`, v ? '1' : '0');
  };

  // One variant is shown at a time, picked from the selector below. The chart and
  // the per-area table reflect either all games of that variant or just the last
  // ATC_RECENT_WINDOW; the stat grid above stays all-time.
  const active = variants.find((v) => v.ring === activeRing) ?? variants[0];
  const variantMatches = atcVariantMatches(matches, playerId, active.ring);
  // Solo games are the ones the player entered themselves, so they're the most
  // trustworthy progression data — in multiplayer games someone else may have
  // entered the darts, possibly out of throw order, which misattributes targets
  // in the per-area table's reconstruction. The toggle only appears when the
  // variant has both kinds; the solo filter applies before the Last-N slice.
  const soloMatches = variantMatches.filter((m) => m.playerIds.length === 1);
  const canFilterSolo = soloMatches.length > 0 && soloMatches.length < variantMatches.length;
  const soloScoped = canFilterSolo && soloOnly;
  const base = soloScoped ? soloMatches : variantMatches;
  const totalGames = base.length;
  const canScope = totalGames > ATC_RECENT_WINDOW;
  const scoped = canScope && recentOnly ? base.slice(-ATC_RECENT_WINDOW) : base;
  // Each variant is indexed by its own game count so its chart starts at game 1.
  const points = atcSeriesByVariant(scoped, playerId).find((s) => s.ring === active.ring)?.points ?? [];
  const targets = atcTargetStats(scoped, playerId, active.ring);
  const targetTrends = new Map(
    atcTargetTrends(scoped, playerId, active.ring).map((t) => [t.target, t.delta]),
  );
  // Trend and rolling lines follow the chart's scope; the darts metric only
  // counts cleared legs — an uncleared leg's dart count is truncated, so it
  // would drag the "throws to finish" trend down for the wrong reason.
  const hitValues = points.map((p) => p.hitRate);
  const clearedDarts = points.map((p) => (p.cleared ? p.darts : null));
  const hitTrend = trendDelta(hitValues);
  const dartsTrend = trendDelta(clearedDarts.filter((v): v is number => v !== null));
  // Personal bests stay all-time for the variant, like the stat grid.
  const pb = atcPersonalBests(matches, playerId, active.ring);
  const gamesNoun = soloScoped ? 'solo games' : 'games';
  const scopeNote =
    canScope && recentOnly
      ? `the last ${ATC_RECENT_WINDOW} ${gamesNoun}`
      : soloScoped
        ? 'every solo game'
        : 'every game';
  const chartData: ChartData<'line'> = {
    labels: points.map((_, i) => `Leg ${i + 1}`),
    datasets: [
      {
        label: 'Hit %',
        data: points.map((p) => round(p.hitRate)),
        borderColor: BLUE,
        backgroundColor: BLUE,
        tension: 0.25,
        pointRadius: pointSize(points.length),
        yAxisID: 'y',
        order: 3,
      },
      {
        label: 'Darts / leg',
        data: points.map((p) => p.darts),
        borderColor: AMBER,
        backgroundColor: AMBER,
        // Games the player didn't clear get a red point: the game ended early,
        // so their darts count isn't a real throws-to-finish figure.
        pointBackgroundColor: points.map((p) => (p.cleared ? AMBER : ACCENT)),
        pointBorderColor: points.map((p) => (p.cleared ? AMBER : ACCENT)),
        tension: 0.25,
        pointRadius: pointSize(points.length),
        yAxisID: 'yDarts',
        // Lower order draws on top: the amber/red points stay above the Hit %
        // line (order 3), while the dotted rolling averages (order 1) sit in
        // front of both raw series.
        order: 2,
      },
      ...(points.length >= ROLLING_WINDOW
        ? [
            rollingLine(
              `Hit % (${ROLLING_WINDOW}-leg avg)`,
              rollingMean(hitValues, ROLLING_WINDOW),
              BLUE,
              'y',
            ),
            // Cleared legs only; needs 3 of the last 5 to plot a point.
            rollingLine(
              `Darts (${ROLLING_WINDOW}-leg avg)`,
              rollingMean(clearedDarts, ROLLING_WINDOW, 3),
              AMBER,
              'yDarts',
            ),
          ]
        : []),
    ],
  };

  return (
    <>
      {variants.length > 1 && (
        <div className="chip-row">
          {variants.map((v) => (
            <button
              key={v.ring}
              className={`chip ${v.ring === active.ring ? 'active' : ''}`}
              aria-pressed={v.ring === active.ring}
              onClick={() => selectRing(v.ring)}
            >
              {atcRingLabel(v.ring)}
            </button>
          ))}
        </div>
      )}
      <section className="card" key={active.ring}>
        {/* With a variant selector above, a heading naming the active variant
            would just repeat the highlighted chip — only single-variant
            players need the label. */}
        {variants.length === 1 && (
          <h2 className="card-title">
            <span className="ring-dot" style={{ background: RING_COLORS[active.ring] }} />{' '}
            {atcRingLabel(active.ring)}
          </h2>
        )}
        <Grid
          cells={[
            [String(active.competitivePlayed), `Played (${active.played} total)`],
            [active.competitivePlayed === 0 ? '—' : `${active.winRate.toFixed(0)}%`, 'Win Rate'],
            [`${active.hitRate.toFixed(0)}%`, 'Hit Rate'],
            [
              pb.fewestDarts ? String(pb.fewestDarts.value) : '—',
              pb.fewestDarts ? `Fewest Darts · ${shortDate(pb.fewestDarts.date)}` : 'Fewest Darts',
            ],
            [
              pb.bestLegHitRate ? `${pb.bestLegHitRate.value.toFixed(0)}%` : '—',
              pb.bestLegHitRate
                ? `Best Leg Hit % · ${shortDate(pb.bestLegHitRate.date)}`
                : 'Best Leg Hit %',
            ],
            [active.avgDartsToClear > 0 ? active.avgDartsToClear.toFixed(0) : '—', 'Avg Darts'],
          ]}
        />
        {canFilterSolo && (
          <div className="chip-row scope-row">
            <button
              className={`chip ${soloOnly ? '' : 'active'}`}
              aria-pressed={!soloOnly}
              onClick={() => selectSolo(false)}
            >
              All games ({variantMatches.length})
            </button>
            <button
              className={`chip ${soloOnly ? 'active' : ''}`}
              aria-pressed={soloOnly}
              onClick={() => selectSolo(true)}
            >
              Solo only ({soloMatches.length})
            </button>
          </div>
        )}
        {canScope && (
          <div className="chip-row scope-row">
            <button
              className={`chip ${recentOnly ? '' : 'active'}`}
              aria-pressed={!recentOnly}
              onClick={() => selectRecent(false)}
            >
              All ({totalGames})
            </button>
            <button
              className={`chip ${recentOnly ? 'active' : ''}`}
              aria-pressed={recentOnly}
              onClick={() => selectRecent(true)}
            >
              Last {ATC_RECENT_WINDOW} games
            </button>
          </div>
        )}
        {(hitTrend || dartsTrend) && (
          <div className="stat-grid">
            <TrendCell label="Hit %" trend={hitTrend} goodWhen="up" unit="%" />
            <TrendCell label="Darts / leg" trend={dartsTrend} goodWhen="down" />
          </div>
        )}
        {points.length > 0 && (
          <>
            <p className="muted">
              Hit % and throws to finish, per leg.
              {points.length >= ROLLING_WINDOW &&
                ` The dotted lines are ${ROLLING_WINDOW}-leg rolling averages.`}
              {points.some((p) => !p.cleared) &&
                ' Red points mark legs where the board wasn’t cleared.'}
            </p>
            <ExpandableChart title="Hit % and darts per leg">
              <Line data={chartData} options={atcVariantOpts(points)} />
            </ExpandableChart>
          </>
        )}
        <AtcTargets
          targets={targets}
          trends={targetTrends}
          color={RING_COLORS[active.ring]}
          scopeNote={scopeNote}
        />
      </section>
    </>
  );
}

// Per-area hit rate for the active variant, shown inside the variant card below
// the chart. The dart records don't store the aimed target, so atcTargetStats
// reconstructs it from progress.
type AreaSortKey = 'area' | 'hit';
type AreaSortDir = 'asc' | 'desc';

function AtcTargets({
  targets,
  trends,
  color,
  scopeNote,
}: {
  targets: AtcTargetStat[];
  trends: Map<number, number | null>;
  color: string;
  scopeNote: string;
}) {
  const [sortKey, setSortKey] = useState<AreaSortKey>('area');
  const [sortDir, setSortDir] = useState<AreaSortDir>('asc');
  const thrown = targets.filter((t) => t.darts > 0);
  if (thrown.length === 0) return null;

  function toggleSort(key: AreaSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'hit' ? 'desc' : 'asc'); // hit % reads best highest-first
    }
  }
  const ariaSort = (key: AreaSortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const caret = (key: AreaSortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  // Areas never thrown at always sink to the bottom in sequence order; the rest
  // sort by the chosen column, tie-broken by sequence for a stable ordering.
  const sorted = [...targets].sort((a, b) => {
    const aEmpty = a.darts === 0;
    const bEmpty = b.darts === 0;
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return a.target - b.target;
      return aEmpty ? 1 : -1;
    }
    let cmp = sortKey === 'hit' ? a.hitRate - b.hitRate : a.target - b.target;
    if (cmp === 0) cmp = a.target - b.target;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <>
      <p className="muted">Average hit % per area, across {scopeNote}.</p>
      <table className="area-table">
        <thead>
          <tr>
            <th aria-sort={ariaSort('area')}>
              <button type="button" className="area-sort" onClick={() => toggleSort('area')}>
                Area{caret('area')}
              </button>
            </th>
            <th className="num" aria-sort={ariaSort('hit')}>
              <button type="button" className="area-sort" onClick={() => toggleSort('hit')}>
                Hit %{caret('hit')}
              </button>
            </th>
            <th className="num">Hits</th>
            <th className="num">
              <abbr title="Hit % change: recent half of the games vs the earlier half">±</abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const delta = trends.get(t.target) ?? null;
            return (
              <tr key={t.target} className={t.darts === 0 ? 'no-data' : ''}>
                <td className="area-name">{t.label}</td>
                <td className="num">
                  {t.darts === 0 ? (
                    '—'
                  ) : (
                    <span className="area-bar-cell">
                      <span className="area-bar-track">
                        <span
                          className="area-bar-fill"
                          style={{ width: `${t.hitRate}%`, background: color }}
                        />
                      </span>
                      <span className="area-pct">{t.hitRate.toFixed(0)}%</span>
                    </span>
                  )}
                </td>
                <td className="num">{t.darts === 0 ? '—' : `${t.hits}/${t.darts}`}</td>
                <td
                  className={`num trend ${
                    delta === null || Math.round(delta) === 0 ? '' : delta > 0 ? 'good' : 'bad'
                  }`}
                >
                  {delta === null
                    ? '—'
                    : `${delta > 0 ? '▲' : delta < 0 ? '▼' : ''}${Math.abs(delta).toFixed(0)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">
        ± compares each area's hit % in the recent half of those games with the earlier half
        (shown once both halves have enough darts).
      </p>
    </>
  );
}

function Training({ matches, playerId }: { matches: Match[]; playerId: string }) {
  const rounds = trainingRounds(matches, playerId);
  if (rounds.length === 0) {
    return <Empty text="No training recorded yet — start one from New Match." />;
  }

  const best = trainingBestRound(matches, playerId);
  const totalDarts = rounds.reduce((a, r) => a + r.darts, 0);
  const totalResolved = rounds.reduce((a, r) => a + r.resolved, 0);
  const totalAttempts = rounds.reduce((a, r) => a + r.attempts, 0);
  const overallAvg = totalResolved
    ? rounds.reduce((a, r) => a + r.avgDarts * r.resolved, 0) / totalResolved
    : 0;
  const overallFirst = totalAttempts
    ? (rounds.reduce((a, r) => a + (r.firstDartHitRate * r.attempts) / 100, 0) / totalAttempts) *
      100
    : 0;

  // Per-round series: both metrics are per-target figures, so the live round
  // (a uniformly random subset of the bag) plots unbiased alongside complete
  // ones — no red-point treatment needed.
  const points = rounds.map((r) => ({
    label: `${r.label}${r.complete ? '' : ' · in progress'}`,
    cleared: true,
  }));
  const hitValues = rounds.map((r) => r.firstDartHitRate);
  const dartValues = rounds.map((r) => (r.resolved > 0 ? r.avgDarts : null));
  const hitTrend = trendDelta(hitValues);
  const dartsTrend = trendDelta(dartValues.filter((v): v is number => v !== null));
  const chartData: ChartData<'line'> = {
    labels: rounds.map((_, i) => `Round ${i + 1}`),
    datasets: [
      {
        label: 'First-dart Hit %',
        data: hitValues.map(round),
        borderColor: BLUE,
        backgroundColor: BLUE,
        tension: 0.25,
        pointRadius: pointSize(rounds.length),
        yAxisID: 'y',
        order: 3,
      },
      {
        label: 'Avg darts / target',
        data: dartValues.map((v) => (v === null ? null : round(v))),
        borderColor: AMBER,
        backgroundColor: AMBER,
        tension: 0.25,
        pointRadius: pointSize(rounds.length),
        spanGaps: true,
        yAxisID: 'yDarts',
        order: 2,
      },
      ...(rounds.length >= ROLLING_WINDOW
        ? [
            rollingLine(
              `Hit % (${ROLLING_WINDOW}-round avg)`,
              rollingMean(hitValues, ROLLING_WINDOW),
              BLUE,
              'y',
            ),
            rollingLine(
              `Darts (${ROLLING_WINDOW}-round avg)`,
              rollingMean(dartValues, ROLLING_WINDOW, 3),
              AMBER,
              'yDarts',
            ),
          ]
        : []),
    ],
  };

  const fields = new Map(trainingFieldStats(matches, playerId).map((f) => [f.id, f]));
  const cell = (id: string) => {
    const f = fields.get(id);
    if (!f || f.darts === 0) return <td className="num">—</td>;
    return (
      <td className="num" title={`${f.hits}/${f.darts}`}>
        {f.hitRate.toFixed(0)}%
      </td>
    );
  };

  return (
    <>
      <section className="card">
        <Grid
          cells={[
            [String(rounds.filter((r) => r.complete).length), `Rounds (${rounds.length} started)`],
            [
              best ? String(best.value) : '—',
              best ? `Best Round (darts) · ${shortDate(best.date)}` : 'Best Round (darts)',
            ],
            [String(totalResolved), 'Targets Hit'],
            [String(totalDarts), 'Darts Thrown'],
            [overallAvg > 0 ? overallAvg.toFixed(1) : '—', 'Avg Darts / Target'],
            [`${overallFirst.toFixed(0)}%`, 'First-dart Hit %'],
          ]}
        />
        <p className="muted">
          A round is one pass through the shuffle bag — every field on the board, once.
        </p>
      </section>
      {(hitTrend || dartsTrend) && (
        <section className="card">
          <h2 className="card-title">Trend</h2>
          <div className="stat-grid">
            <TrendCell label="First-dart Hit %" trend={hitTrend} goodWhen="up" unit="%" />
            <TrendCell label="Darts / target" trend={dartsTrend} goodWhen="down" />
          </div>
          <p className="muted">Recent rounds vs the rounds before them — green is improving.</p>
        </section>
      )}
      <section className="card">
        <h2 className="card-title">Progression</h2>
        <p className="muted">
          First-dart hit % and darts per target, per round.
          {rounds.length >= ROLLING_WINDOW &&
            ` The dotted lines are ${ROLLING_WINDOW}-round rolling averages.`}
        </p>
        <ExpandableChart title="Training progression">
          <Line data={chartData} options={atcVariantOpts(points, 'Avg darts / target')} />
        </ExpandableChart>
      </section>
      <section className="card">
        <h2 className="card-title">Hit % Per Field</h2>
        <p className="muted">
          Across all training. Tap and hold a cell for its hits/darts.
        </p>
        <table className="area-table">
          <thead>
            <tr>
              <th>Field</th>
              <th className="num">Single</th>
              <th className="num">Double</th>
              <th className="num">Treble</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <tr key={n}>
                <td className="area-name">{n}</td>
                {cell(`S${n}`)}
                {cell(`D${n}`)}
                {cell(`T${n}`)}
              </tr>
            ))}
            <tr>
              {/* The bull row: its "single" is the outer (25), its "double" the
                  bull (50); a treble bull doesn't exist. */}
              <td className="area-name">{trainingFieldLabel('D25')}</td>
              {cell('S25')}
              {cell('D25')}
              <td className="num">—</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
