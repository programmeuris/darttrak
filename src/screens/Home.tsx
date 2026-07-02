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
  const [pendingDelete, setPendingDelete] = useState<Player | null>(null);
  const [exportedBeforeDelete, setExportedBeforeDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const refresh = () =>
    getPlayers()
      .then(setPlayers)
      .catch((err) => {
        console.error(err);
        toast('Failed to load players', 'error');
      });
  useEffect(() => {
    refresh();
  }, []);

  // aria-modal hides the rest of the page from assistive tech, so focus must
  // move into the dialog while it's open and back to the trigger on close.
  // Cancel gets initial focus — the safe default for a destructive dialog.
  useEffect(() => {
    if (pendingDelete) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      cancelRef.current?.focus();
    } else {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    }
  }, [pendingDelete]);

  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setPendingDelete(null);
      return;
    }
    if (e.key !== 'Tab') return;
    // Keep Tab cycling inside the dialog (its only focusables are buttons).
    const focusables = modalRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!focusables?.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('Enter a name first', 'error');
      return;
    }
    try {
      await addPlayer(trimmed);
    } catch (err) {
      console.error(err);
      toast('Could not save the player. Try again.', 'error');
      return;
    }
    setName('');
    await refresh();
    toast(`Added ${trimmed}`);
  }

  function handleDelete(p: Player) {
    setExportedBeforeDelete(false);
    setPendingDelete(p);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id, name } = pendingDelete;
    setPendingDelete(null);
    try {
      await deletePlayer(id);
    } catch (err) {
      console.error(err);
      toast('Delete failed — nothing was removed. Try again.', 'error');
      return;
    }
    await refresh();
    toast(`Deleted ${name} and their matches`);
  }

  async function handleExport(): Promise<boolean> {
    let data: ExportBundle;
    try {
      data = await exportAllData();
    } catch (err) {
      console.error(err);
      toast('Export failed. Try again.', 'error');
      return false;
    }
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
    return true;
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

      {pendingDelete && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          onClick={() => setPendingDelete(null)}
          onKeyDown={onModalKeyDown}
        >
          <div className="modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title" id="delete-modal-title">
              Delete “{pendingDelete.name}”?
            </h2>
            <p className="muted">
              This permanently removes {pendingDelete.name} and every match they played — it
              can’t be undone. Export a backup first if you might want this data back.
            </p>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={async () => {
                  if (await handleExport()) setExportedBeforeDelete(true);
                }}
              >
                {exportedBeforeDelete ? '✓ Backup saved' : '⬇ Export backup'}
              </button>
              <button className="btn" ref={cancelRef} onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button className="btn danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
