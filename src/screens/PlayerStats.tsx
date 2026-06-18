import { useEffect, useState, type ReactNode } from 'react';
import 'chart.js/auto';
import { Line, Bar } from 'react-chartjs-2';
import type { ChartData, ChartDataset, ChartOptions } from 'chart.js';
import { navigate } from '../router';
import { Header, StatCell } from '../components/Header';
import { getPlayers, getAllMatches } from '../db';
import { computePlayerOverview, averagePerMatch, scoreDistribution } from '../stats';
import { consistencyStats, finishingStats, scoringStats, headToHead } from '../analysis';
import { atcStatsByVariant, atcPerMatch, atcRingLabel } from '../atc';
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

type TabId = 'overview' | 'consistency' | 'finishing' | 'scoring' | 'h2h' | 'atc';
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'consistency', label: 'Consistency' },
  { id: 'finishing', label: 'Finishing' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'h2h', label: 'Head-to-Head' },
  { id: 'atc', label: 'Around the Clock' },
];

export function PlayerStats() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [tab, setTab] = useState<TabId>('overview');

  useEffect(() => {
    Promise.all([getPlayers(), getAllMatches()]).then(([ps, ms]) => {
      setPlayers(ps);
      setMatches(ms);
      if (ps.length) setPlayerId(ps[0].id);
    });
  }, []);

  if (players.length === 0) {
    return (
      <div className="screen">
        <Header title="Player Stats" onBack={() => navigate('/')} />
        <p className="muted center">Add players to see stats.</p>
      </div>
    );
  }

  const names = new Map(players.map((p) => [p.id, p.name]));

  return (
    <div className="screen">
      <Header title="Player Stats" onBack={() => navigate('/')} />
      <section className="card">
        <label className="field-label">Player</label>
        <select className="select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          {players.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </section>

      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${t.id === tab ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

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
  const lineData: ChartData<'line'> = {
    labels: avg.map((p) => p.label),
    datasets: [line('3-Dart Avg', avg.map((p) => round(p.average)), ACCENT, true)],
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
            [String(o.matchesPlayed), 'Played'],
            [String(o.matchesWon), 'Won'],
            [`${o.winRate.toFixed(0)}%`, 'Win Rate'],
            [o.overallAverage.toFixed(1), 'Overall Avg'],
            [o.bestMatchAverage.toFixed(1), 'Best Match Avg'],
            [String(o.total180s), '180s'],
            [o.bestCheckout > 0 ? String(o.bestCheckout) : '—', 'Best Checkout'],
          ]}
        />
      </section>
      <ChartCard title="Average Per Match">
        <Line data={lineData} options={lineOpts} />
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
  const variants = atcStatsByVariant(matches, playerId);
  if (variants.length === 0) return <Empty text="No completed Around the Clock matches yet." />;
  const points = atcPerMatch(matches, playerId);
  const hitData: ChartData<'line'> = {
    labels: points.map((p) => p.label),
    datasets: variants.map((v) => ({
      label: atcRingLabel(v.ring),
      data: points.map((p) => (p.ring === v.ring ? round(p.hitRate) : null)),
      borderColor: RING_COLORS[v.ring],
      backgroundColor: RING_COLORS[v.ring],
      spanGaps: true,
      tension: 0.25,
      pointRadius: 3,
    })),
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
              [String(v.played), 'Played'],
              [`${v.winRate.toFixed(0)}%`, 'Win Rate'],
              [`${v.hitRate.toFixed(0)}%`, 'Hit Rate'],
              [v.fewestToClear > 0 ? String(v.fewestToClear) : '—', 'Fewest Darts'],
              [v.avgDartsToClear > 0 ? v.avgDartsToClear.toFixed(0) : '—', 'Avg Darts'],
            ]}
          />
        </section>
      ))}
      <ChartCard title="Hit % Over Time" subtitle="One line per variant — gaps where that variant wasn’t played.">
        <Line data={hitData} options={lineOpts} />
      </ChartCard>
      <ChartCard title="Avg Darts to Clear" subtitle="Average darts to clear a leg, by variant (lower is better).">
        <Bar data={dartsData} options={barOpts} />
      </ChartCard>
    </>
  );
}
