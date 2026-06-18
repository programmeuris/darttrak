import { el, mount, header, toast, confirmDialog } from '../ui';
import { navigate } from '../router';
import { getAllMatches, getPlayers, getMatch, deleteMatch } from '../db';
import { startingScore } from '../scoring';
import { ATC_TARGET_COUNT, atcRingLabel } from '../atc';
import type { Player, GameType } from '../types';

export async function renderHistory(root: HTMLElement, matchId?: string): Promise<void> {
  if (matchId) {
    await renderMatchDetail(root, matchId);
    return;
  }

  const [matches, players] = await Promise.all([getAllMatches(), getPlayers()]);
  const names = new Map<string, string>(players.map((p: Player) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Unknown';

  const filter = { playerId: '', gameType: '' as '' | GameType };

  const listContainer = el('div', { class: 'match-list' });

  function applyAndRender(): void {
    let list = matches;
    if (filter.playerId) list = list.filter((m) => m.playerIds.includes(filter.playerId));
    if (filter.gameType) list = list.filter((m) => m.gameType === filter.gameType);

    if (list.length === 0) {
      listContainer.replaceChildren(
        el('p', { class: 'muted center' }, ['No matches found.']),
      );
      return;
    }

    listContainer.replaceChildren(
      ...list.map((m) => {
        const playerLabel = m.playerIds.map(nameOf).join(' vs ');
        const statusTag =
          m.status === 'in_progress'
            ? el('span', { class: 'tag in-progress' }, ['In progress'])
            : el('span', { class: 'tag' }, [`🏆 ${m.winnerId ? nameOf(m.winnerId) : '—'}`]);
        return el('div', { class: 'match-row' }, [
          el(
            'button',
            {
              class: 'match-main',
              onClick: () =>
                navigate(m.status === 'in_progress' ? `/live/${m.id}` : `/history/${m.id}`),
            },
            [
              el('div', { class: 'match-line1' }, [
                el('span', { class: 'match-game' }, [m.gameType]),
                el('span', { class: 'match-date' }, [
                  new Date(m.date).toLocaleDateString(),
                ]),
              ]),
              el('div', { class: 'match-players' }, [playerLabel]),
              statusTag,
            ],
          ),
          el(
            'button',
            {
              class: 'icon-btn danger',
              'aria-label': 'Delete match',
              onClick: async () => {
                if (!confirmDialog('Delete this match permanently?')) return;
                await deleteMatch(m.id);
                const idx = matches.findIndex((x) => x.id === m.id);
                if (idx >= 0) matches.splice(idx, 1);
                applyAndRender();
                toast('Match deleted');
              },
            },
            ['✕'],
          ),
        ]);
      }),
    );
  }

  const playerFilter = el(
    'select',
    {
      class: 'select',
      onChange: (e: Event) => {
        filter.playerId = (e.target as HTMLSelectElement).value;
        applyAndRender();
      },
    },
    [
      el('option', { value: '' }, ['All players']),
      ...players.map((p) => el('option', { value: p.id }, [p.name])),
    ],
  );

  const gameFilter = el(
    'select',
    {
      class: 'select',
      onChange: (e: Event) => {
        filter.gameType = (e.target as HTMLSelectElement).value as '' | GameType;
        applyAndRender();
      },
    },
    [
      el('option', { value: '' }, ['All games']),
      el('option', { value: '501' }, ['501']),
      el('option', { value: '301' }, ['301']),
      el('option', { value: 'AroundTheClock' }, ['Around the Clock']),
    ],
  );

  applyAndRender();

  mount(
    root,
    el('div', { class: 'screen' }, [
      header('Match History', () => navigate('/')),
      el('section', { class: 'card' }, [
        el('div', { class: 'filter-row' }, [playerFilter, gameFilter]),
      ]),
      listContainer,
    ]),
  );
}

async function renderMatchDetail(root: HTMLElement, matchId: string): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) {
    toast('Match not found', 'error');
    navigate('/history');
    return;
  }
  const players = await getPlayers();
  const names = new Map<string, string>(players.map((p: Player) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? 'Unknown';
  const isAtc = match.gameType === 'AroundTheClock';
  const start = startingScore(match.gameType === '301' ? '301' : '501');
  const cols = isAtc
    ? ['Player', 'Darts', 'Hits', 'Cleared']
    : ['Player', 'Darts', 'Scored', 'Left'];

  const legSections = match.legs.map((leg, i) => {
    const rows = leg.turns.map((turn) =>
      el('tr', { class: turn.isBust ? 'bust' : '' }, [
        el('td', {}, [nameOf(turn.playerId)]),
        el('td', {}, [turn.darts.map((d) => d.label).join(' · ')]),
        el('td', { class: 'num' }, [
          isAtc ? `+${turn.totalScore}` : turn.isBust ? 'BUST' : String(turn.totalScore),
        ]),
        el('td', { class: 'num' }, [
          isAtc ? `${turn.remainingScore}/${ATC_TARGET_COUNT}` : String(turn.remainingScore),
        ]),
      ]),
    );
    return el('section', { class: 'card' }, [
      el('h2', { class: 'card-title' }, [
        `Leg ${i + 1}`,
        leg.winnerId ? el('span', { class: 'badge' }, [` · ${nameOf(leg.winnerId)}`]) : null,
      ]),
      el('table', { class: 'turn-table' }, [
        el('thead', {}, [
          el('tr', {}, cols.map((c, ci) => el('th', { class: ci >= 2 ? 'num' : '' }, [c]))),
        ]),
        el('tbody', {}, rows.length ? rows : [
          el('tr', {}, [el('td', { colspan: 4, class: 'muted' }, ['No turns'])]),
        ]),
      ]),
    ]);
  });

  mount(
    root,
    el('div', { class: 'screen' }, [
      header('Match Detail', () => navigate('/history')),
      el('section', { class: 'card' }, [
        el('div', { class: 'match-line1' }, [
          el('span', { class: 'match-game' }, [match.gameType]),
          el('span', { class: 'match-date' }, [new Date(match.date).toLocaleString()]),
        ]),
        el('div', { class: 'match-players' }, [match.playerIds.map(nameOf).join(' vs ')]),
        el('div', { class: 'muted' }, [
          isAtc
            ? `Best of ${match.format.legs} · ${atcRingLabel(match.atcRing ?? 'single')}`
            : `Best of ${match.format.legs} · ${match.doubleOut ? 'Double Out' : 'Straight Out'} · Start ${start}`,
        ]),
        match.status === 'completed'
          ? el('div', { class: 'tag' }, [`🏆 ${match.winnerId ? nameOf(match.winnerId) : '—'}`])
          : el('button', { class: 'btn primary', onClick: () => navigate(`/live/${match.id}`) }, [
              'Resume Match',
            ]),
      ]),
      ...legSections,
      match.status === 'completed'
        ? el('button', { class: 'btn full', onClick: () => navigate(`/summary/${match.id}`) }, [
            'View Summary',
          ])
        : null,
    ]),
  );
}
