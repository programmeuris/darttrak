/** Hash-based router. Screens call navigate(); main.ts listens for changes. */

export interface Route {
  name: string;
  params: string[];
}

export function navigate(path: string): void {
  const normalized = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === normalized) {
    // Force a re-render even if the hash is unchanged.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = normalized;
  }
}

export function parseRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const name = parts[0] ?? 'home';
  return { name, params: parts.slice(1) };
}
