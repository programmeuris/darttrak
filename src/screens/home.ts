import { el, mount, toast, confirmDialog } from '../ui';
import { navigate } from '../router';
import {
  getPlayers,
  addPlayer,
  deletePlayer,
  exportAllData,
  importAllData,
} from '../db';
import type { Player, ExportBundle } from '../types';

export async function renderHome(root: HTMLElement): Promise<void> {
  const players = await getPlayers();

  const rosterList = el('ul', { class: 'roster' });

  function renderRoster(list: Player[]): void {
    rosterList.replaceChildren(
      ...(list.length === 0
        ? [el('li', { class: 'empty' }, ['No players yet. Add one below.'])]
        : list.map((p) =>
            el('li', { class: 'roster-item' }, [
              el('span', { class: 'roster-name' }, [p.name]),
              el(
                'button',
                {
                  class: 'icon-btn danger',
                  'aria-label': `Delete ${p.name}`,
                  onClick: async () => {
                    if (!confirmDialog(`Delete player "${p.name}"?`)) return;
                    await deletePlayer(p.id);
                    const updated = await getPlayers();
                    renderRoster(updated);
                    toast(`Deleted ${p.name}`);
                  },
                },
                ['✕'],
              ),
            ]),
          )),
    );
  }
  renderRoster(players);

  const nameInput = el('input', {
    class: 'text-input',
    type: 'text',
    placeholder: 'New player name',
    maxlength: 24,
  }) as HTMLInputElement;

  async function handleAdd(): Promise<void> {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Enter a name first', 'error');
      return;
    }
    await addPlayer(name);
    nameInput.value = '';
    renderRoster(await getPlayers());
    toast(`Added ${name}`);
  }

  nameInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') handleAdd();
  });

  const addRow = el('div', { class: 'add-row' }, [
    nameInput,
    el('button', { class: 'btn', onClick: handleAdd }, ['Add']),
  ]);

  const actions = el('div', { class: 'home-actions' }, [
    el('button', { class: 'btn primary big', onClick: () => navigate('/setup') }, [
      '🎯 New Match',
    ]),
    el('button', { class: 'btn', onClick: () => navigate('/history') }, [
      'History',
    ]),
    el('button', { class: 'btn', onClick: () => navigate('/stats') }, ['Stats']),
  ]);

  mount(
    root,
    el('div', { class: 'screen' }, [
      el('header', { class: 'screen-header center' }, [
        el('h1', { class: 'app-title' }, ['🎯 Darts Tracker']),
      ]),
      actions,
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title' }, ['Players']),
        rosterList,
        addRow,
      ]),
      buildDataSection(),
    ]),
  );
}

function buildDataSection(): HTMLElement {
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'hidden-file',
  }) as HTMLInputElement;

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (
      !confirmDialog(
        'Importing will OVERWRITE all existing players and matches. Continue?',
      )
    ) {
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text) as ExportBundle;
      if (!Array.isArray(data.players) || !Array.isArray(data.matches)) {
        throw new Error('Invalid file format');
      }
      await importAllData(data);
      toast('Data imported');
      navigate('/');
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'error');
    } finally {
      fileInput.value = '';
    }
  });

  async function handleExport(): Promise<void> {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = el('a', { href: url, download: `darts-backup-${stamp}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  }

  return el('section', { class: 'card' }, [
    el('h2', { class: 'card-title' }, ['Backup & Restore']),
    el('p', { class: 'muted' }, [
      'Your data lives only in this browser. Export regularly to keep a backup.',
    ]),
    el('div', { class: 'add-row' }, [
      el('button', { class: 'btn', onClick: handleExport }, ['⬇ Export']),
      el('button', { class: 'btn', onClick: () => fileInput.click() }, [
        '⬆ Import',
      ]),
    ]),
    fileInput,
  ]);
}
