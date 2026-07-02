/** Hash-based router. Screens call navigate(); main.ts listens for changes. */

export interface Route {
  name: string;
  params: string[];
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const normalized = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === normalized) {
    // Force a re-render even if the hash is unchanged.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (opts.replace) {
    // Swap the current history entry instead of pushing one. Redirects must
    // use this: a pushed redirect leaves the redirecting route in history, so
    // the Back button lands on it, triggers the redirect again, and the user
    // bounces forward forever (e.g. Summary → Back → completed Live → Summary).
    location.replace(normalized);
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
