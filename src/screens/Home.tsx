import { useEffect, useRef, useState } from 'react';
import { navigate } from '../router';
import { toast, confirmDialog } from '../toast';
import {
  getPlayers,
  addPlayer,
  deletePlayer,
  exportAllData,
  importAllData,
} from '../db';
import type { Player, ExportBundle } from '../types';

export function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => getPlayers().then(setPlayers);
  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Enter a name first', 'error');
      return;
    }
    await addPlayer(trimmed);
    setName('');
    await refresh();
    toast(`Added ${trimmed}`);
  }

  async function handleDelete(p: Player) {
    if (!confirmDialog(`Delete player "${p.name}"?`)) return;
    await deletePlayer(p.id);
    await refresh();
    toast(`Deleted ${p.name}`);
  }

  async function handleExport() {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `darts-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirmDialog('Importing will OVERWRITE all existing players and matches. Continue?')) {
      e.target.value = '';
      return;
    }
    try {
      const data = JSON.parse(await file.text()) as ExportBundle;
      if (!Array.isArray(data.players) || !Array.isArray(data.matches)) {
        throw new Error('Invalid file format');
      }
      await importAllData(data);
      toast('Data imported');
      await refresh();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'error');
    } finally {
      e.target.value = '';
    }
  }

  return (
    <div className="screen">
      <header className="screen-header center">
        <h1 className="app-title">🎯 DartTrak</h1>
      </header>

      <div className="home-actions">
        <button className="btn primary big" onClick={() => navigate('/setup')}>
          🎯 New Match
        </button>
      </div>

      <section className="card">
        <h2 className="card-title">Players</h2>
        <ul className="roster">
          {players.length === 0 ? (
            <li className="empty">No players yet. Add one below.</li>
          ) : (
            players.map((p) => (
              <li className="roster-item" key={p.id}>
                <button
                  className="roster-name"
                  aria-label={`Open ${p.name}'s profile`}
                  onClick={() => navigate(`/player/${p.id}`)}
                >
                  {p.name}
                  <span className="roster-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => handleDelete(p)}
                >
                  ✕
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="add-row">
          <input
            className="text-input"
            type="text"
            placeholder="New player name"
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn" onClick={handleAdd}>
            Add
          </button>
        </div>
      </section>

      <button className="btn full" onClick={() => navigate('/history')}>
        History
      </button>

      <section className="card">
        <h2 className="card-title">Backup &amp; Restore</h2>
        <p className="muted">
          Your data lives only in this browser. Export regularly to keep a backup.
        </p>
        <div className="add-row">
          <button className="btn" onClick={handleExport}>
            ⬇ Export
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⬆ Import
          </button>
        </div>
        <input
          ref={fileRef}
          className="hidden-file"
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
        />
      </section>
    </div>
  );
}
