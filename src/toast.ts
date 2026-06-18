/** Imperative toast + confirm helpers — framework-agnostic, used from anywhere. */

let toastTimer: number | undefined;

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let node = document.getElementById('toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.className = 'toast';
    document.body.append(node);
  }
  node.textContent = message;
  node.className = `toast show ${kind}`;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node!.className = 'toast';
  }, 2600);
}

export function confirmDialog(message: string): boolean {
  return window.confirm(message);
}
