import { el, mount, header, toast } from '../ui';
import { navigate } from '../router';
import { getPlayers, saveMatch, uuid } from '../db';
import type { GameType, Match, Leg, Player, AtcRing } from '../types';

const SUPPORTED_GAMES: { type: GameType; label: string; enabled: boolean }[] = [
  { type: '501', label: '501', enabled: true },
  { type: '301', label: '301', enabled: true },
  { type: 'AroundTheClock', label: 'Around the Clock', enabled: true },
  { type: 'Cricket', label: 'Cricket', enabled: false },
];

const FORMATS = [
  { legs: 1, label: 'Best of 1' },
  { legs: 3, label: 'Best of 3' },
  { legs: 5, label: 'Best of 5' },
];

const RINGS: { ring: AtcRing; label: string }[] = [
  { ring: 'single', label: 'Singles' },
  { ring: 'double', label: 'Doubles' },
  { ring: 'triple', label: 'Trebles' },
  { ring: 'progressive', label: 'Progressive' },
];

export async function renderSetup(root: HTMLElement): Promise<void> {
  const players = await getPlayers();

  const state = {
    gameType: '501' as GameType,
    selectedPlayers: [] as string[],
    legs: 1,
    doubleOut: true,
    atcRing: 'single' as AtcRing,
  };

  const isAtc = () => state.gameType === 'AroundTheClock';

  // ---- Game type ----
  const gameButtons = SUPPORTED_GAMES.map((g) =>
    el(
      'button',
      {
        class: `chip ${g.type === state.gameType ? 'active' : ''}`,
        disabled: !g.enabled,
        title: g.enabled ? '' : 'Coming soon',
        onClick: () => {
          if (!g.enabled) return;
          state.gameType = g.type;
          gameButtons.forEach((b, i) =>
            b.classList.toggle('active', SUPPORTED_GAMES[i].type === g.type),
          );
          updateGameSpecific();
        },
      },
      [g.enabled ? g.label : `${g.label} (soon)`],
    ),
  );

  // ---- Players (checkboxes) ----
  function renderPlayerPicker(): HTMLElement {
    if (players.length === 0) {
      return el('p', { class: 'muted' }, [
        'No players yet — add some on the Home screen first.',
      ]);
    }
    return el(
      'div',
      { class: 'check-grid' },
      players.map((p: Player) =>
        el('label', { class: 'check-item' }, [
          el('input', {
            type: 'checkbox',
            onChange: (e: Event) => {
              const checked = (e.target as HTMLInputElement).checked;
              if (checked) {
                if (state.selectedPlayers.length >= 4) {
                  (e.target as HTMLInputElement).checked = false;
                  toast('Max 4 players', 'error');
                  return;
                }
                state.selectedPlayers.push(p.id);
              } else {
                state.selectedPlayers = state.selectedPlayers.filter((id) => id !== p.id);
              }
            },
          }),
          el('span', {}, [p.name]),
        ]),
      ),
    );
  }

  // ---- Format ----
  const formatButtons = FORMATS.map((f) =>
    el(
      'button',
      {
        class: `chip ${f.legs === state.legs ? 'active' : ''}`,
        onClick: () => {
          state.legs = f.legs;
          formatButtons.forEach((b, i) =>
            b.classList.toggle('active', FORMATS[i].legs === f.legs),
          );
        },
      },
      [f.label],
    ),
  );

  // ---- Double out toggle (x01 only) ----
  const doubleOutToggle = el('input', {
    type: 'checkbox',
    checked: state.doubleOut,
    onChange: (e: Event) => {
      state.doubleOut = (e.target as HTMLInputElement).checked;
    },
  }) as HTMLInputElement;

  const doubleOutCard = el('section', { class: 'card' }, [
    el('label', { class: 'toggle-row' }, [
      el('span', {}, ['Double Out']),
      doubleOutToggle,
    ]),
  ]);

  // ---- Ring selector (Around the Clock only) ----
  const ringButtons = RINGS.map((r) =>
    el(
      'button',
      {
        class: `chip ${r.ring === state.atcRing ? 'active' : ''}`,
        onClick: () => {
          state.atcRing = r.ring;
          ringButtons.forEach((b, i) =>
            b.classList.toggle('active', RINGS[i].ring === r.ring),
          );
        },
      },
      [r.label],
    ),
  );

  const ringCard = el('section', { class: 'card' }, [
    el('h2', { class: 'card-title' }, ['Ring']),
    el('p', { class: 'muted' }, [
      'Which ring counts as a hit. Progressive lets any ring hit, but doubles advance +2 and trebles +3. Tracked separately in your stats.',
    ]),
    el('div', { class: 'chip-row' }, ringButtons),
  ]);

  // Show the option set that matches the chosen game.
  function updateGameSpecific(): void {
    doubleOutCard.style.display = isAtc() ? 'none' : '';
    ringCard.style.display = isAtc() ? '' : 'none';
  }
  updateGameSpecific();

  async function startMatch(): Promise<void> {
    if (state.selectedPlayers.length < 1) {
      toast('Select at least one player', 'error');
      return;
    }
    const matchId = uuid();
    const firstLeg: Leg = { id: uuid(), matchId, winnerId: null, turns: [] };
    const match: Match = {
      id: matchId,
      date: Date.now(),
      gameType: state.gameType,
      playerIds: [...state.selectedPlayers],
      winnerId: null,
      format: { legs: state.legs, sets: 1 },
      doubleOut: state.doubleOut,
      atcRing: isAtc() ? state.atcRing : undefined,
      status: 'in_progress',
      legs: [firstLeg],
    };
    await saveMatch(match);
    navigate(`/live/${matchId}`);
  }

  mount(
    root,
    el('div', { class: 'screen' }, [
      header('New Match', () => navigate('/')),
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Game Type']),
        el('div', { class: 'chip-row' }, gameButtons),
      ]),
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Players (1–4)']),
        renderPlayerPicker(),
      ]),
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Format']),
        el('div', { class: 'chip-row' }, formatButtons),
      ]),
      doubleOutCard,
      ringCard,
      el('button', { class: 'btn primary big full', onClick: startMatch }, ['Start Match']),
    ]),
  );
}
