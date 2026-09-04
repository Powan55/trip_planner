// Service-worker handler behaviour, driven against the REAL emitted worker source.
//
// `scripts/gen-sw.mjs` builds the worker as one template literal and writes it to
// `out/sw.js` at build time, so the only browser-level coverage (`e2e/pwa*.spec.ts`)
// needs a full `next build` first. This file closes that gap for the routing logic:
// it lifts the same template out of the generator, fills in the seven build-time
// interpolations, and evaluates it with fake globals — the same technique
// `e2e/pwa-torn-update.spec.ts` uses on the shipped file, minus the build.
//
// What it pins is behaviour a wrong edit silently breaks and no other test sees:
// the origin-scoped activate sweep, offline route-to-route navigation, `_rsc` key
// collapsing, precache-before-runtime image ordering, and the promise that a
// rejecting Cache Storage degrades instead of taking the response down.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Lift the worker template out of the generator and instantiate it.

const ORIGIN = 'https://example.test';
const PRECACHE = 'trip-precache-testhash';
const IMAGES_CACHE = 'trip-images-v1';
const FRANKFURTER_CACHE = 'trip-frankfurter-v1';
const NAV_FALLBACK = '/';
const PRECACHE_URLS = ['/', '/404.html', '/plan/', '/travel/', '/images/hero/hero.avif'];

const genSwSrc = readFileSync(resolve(__dirname, '../../scripts/gen-sw.mjs'), 'utf8');

function extractWorkerSource(): string {
  const startAnchor = 'return `/* AUTO-GENERATED';
  const start = genSwSrc.indexOf(startAnchor);
  const end = genSwSrc.search(/\r?\n`;\r?\n\}/);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      'sw-handlers.test: could not locate the buildServiceWorker() template literal in ' +
        'scripts/gen-sw.mjs. If the emitter was restructured, re-point these anchors — ' +
        'do not delete the test.'
    );
  }
  const template = genSwSrc.slice(start + 'return `'.length, end);
  // Re-evaluate the raw text as a template literal in a scope holding the same
  // build-time values gen-sw.mjs interpolates. Escapes resolve exactly as they do in
  // the generator, so this is the emitted worker, not a paraphrase of it.
  return new Function(
    'PRECACHE',
    'IMAGES_CACHE',
    'IMAGE_CACHE_LIMIT',
    'NAV_FALLBACK',
    'precacheUrls',
    'withBase',
    'return `' + template + '`'
  )(PRECACHE, IMAGES_CACHE, 80, NAV_FALLBACK, PRECACHE_URLS, (p: string) => p);
}

const WORKER_SOURCE = extractWorkerSource();

// ---------------------------------------------------------------------------
// Fakes. Deliberately tiny: enough surface for the handlers, nothing more.

class FakeResponse {
  body: string;
  ok: boolean;
  status: number;
  type: string;
  redirected: boolean;
  headers: { get(name: string): string | null };

  constructor(
    body: string,
    init: { ok?: boolean; status?: number; type?: string; contentType?: string } = {}
  ) {
    this.body = body;
    this.ok = init.ok ?? true;
    this.status = init.status ?? 200;
    this.type = init.type ?? 'basic';
    this.redirected = false;
    const contentType = init.contentType ?? 'text/html';
    this.headers = { get: (n) => (n.toLowerCase() === 'content-type' ? contentType : null) };
  }

  clone(): FakeResponse {
    return this;
  }

  static error(): FakeResponse {
    return new FakeResponse('', { ok: false, status: 0, type: 'error' });
  }
}

type Keyish = string | { url: string };

// The Cache API resolves a string key against the worker's scope, so a stored
// '/plan/' and a request for `${ORIGIN}/plan/` are the same entry.
function keyOf(k: Keyish): string {
  const raw = typeof k === 'string' ? k : k.url;
  return raw.startsWith(ORIGIN) ? raw.slice(ORIGIN.length) : raw;
}

interface FakeCacheStorage {
  open(name: string): Promise<{
    put(k: Keyish, v: FakeResponse): Promise<void>;
    match(k: Keyish): Promise<FakeResponse | undefined>;
    keys(): Promise<string[]>;
    delete(k: Keyish): Promise<boolean>;
  }>;
  keys(): Promise<string[]>;
  match(k: Keyish, options?: { cacheName?: string }): Promise<FakeResponse | undefined>;
  delete(name: string): Promise<boolean>;
}

function makeCaches(
  initial: Record<string, Record<string, string>>,
  opts: { rejectMatch?: boolean } = {}
) {
  const stores = new Map<string, Map<string, FakeResponse>>();
  for (const [name, entries] of Object.entries(initial)) {
    const store = new Map<string, FakeResponse>();
    for (const [k, body] of Object.entries(entries)) store.set(keyOf(k), new FakeResponse(body));
    stores.set(name, store);
  }
  const deleted: string[] = [];
  const put: Array<{ cache: string; key: string }> = [];

  const caches: FakeCacheStorage = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async put(k, v) {
          put.push({ cache: name, key: keyOf(k) });
          store.set(keyOf(k), v);
        },
        async match(k) {
          return store.get(keyOf(k));
        },
        async keys() {
          return [...store.keys()];
        },
        async delete(k) {
          return store.delete(keyOf(k));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async match(k, options) {
      if (opts.rejectMatch) throw new DOMException('corrupted store', 'UnknownError');
      const names = options?.cacheName ? [options.cacheName] : [...stores.keys()];
      for (const name of names) {
        const hit = stores.get(name)?.get(keyOf(k));
        if (hit) return hit;
      }
      return undefined;
    },
    async delete(name) {
      deleted.push(name);
      return stores.delete(name);
    },
  };

  return { caches, deleted, put, stores };
}

interface Handlers {
  install?: (e: unknown) => void;
  activate?: (e: unknown) => void;
  fetch?: (e: unknown) => void;
  message?: (e: unknown) => void;
}

function instantiate(
  caches: FakeCacheStorage,
  fetchImpl: (req: Keyish) => Promise<FakeResponse>
): Handlers {
  const handlers: Handlers = {};
  const self = {
    addEventListener: (t: keyof Handlers, cb: (e: unknown) => void) => {
      handlers[t] = cb;
    },
    location: { origin: ORIGIN },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  new Function('self', 'caches', 'fetch', 'Response', 'location', WORKER_SOURCE)(
    self,
    caches,
    fetchImpl,
    FakeResponse,
    { origin: ORIGIN, href: ORIGIN + '/' }
  );
  return handlers;
}

function makeRequest(path: string, over: Partial<Record<string, string>> = {}) {
  return {
    url: path.startsWith('http') ? path : ORIGIN + path,
    method: 'GET',
    mode: 'cors',
    destination: '',
    ...over,
  };
}

/** Drive the fetch handler once and resolve with whatever it responds with. */
function runFetch(handlers: Handlers, request: ReturnType<typeof makeRequest>) {
  return new Promise<FakeResponse | undefined>((resolve, reject) => {
    let responded = false;
    const event = {
      request,
      respondWith: (p: Promise<FakeResponse>) => {
        responded = true;
        Promise.resolve(p).then(
          // flush a macrotask so fire-and-forget cache writes settle
          (res) => setTimeout(() => resolve(res), 0),
          reject
        );
      },
    };
    handlers.fetch!(event);
    if (!responded) resolve(undefined); // handler passed the request through
  });
}

// ---------------------------------------------------------------------------

describe('service worker: the emitted source is intact', () => {
  it('extracts and evaluates without a build', () => {
    expect(WORKER_SOURCE).toContain('AUTO-GENERATED by scripts/gen-sw.mjs');
    expect(WORKER_SOURCE).toContain(`const PRECACHE = "${PRECACHE}"`);
    // No unresolved interpolation survived the lift.
    expect(WORKER_SOURCE).not.toContain('${');
  });
});

describe('activate: the cache sweep is scoped to this app', () => {
  it('drops our stale caches and leaves every other app on the origin alone', async () => {
    // caches.keys() is ORIGIN-scoped, and powan55.github.io is a shared GitHub Pages
    // account origin — a sibling project's caches are visible from here.
    const { caches, deleted } = makeCaches({
      [PRECACHE]: {},
      [IMAGES_CACHE]: {},
      [FRANKFURTER_CACHE]: {},
      'trip-precache-oldbuild': {},
      'trip-images-v0': {},
      'sibling-app-shell-v3': {},
      'workbox-precache-v2-https://powan55.github.io/other/': {},
    });
    const handlers = instantiate(caches, async () => new FakeResponse('x'));

    await new Promise<void>((res, rej) => {
      handlers.activate!({ waitUntil: (p: Promise<unknown>) => Promise.resolve(p).then(() => res(), rej) });
    });

    // Ours, superseded → collected (this is the atomic-activation half).
    expect(deleted).toContain('trip-precache-oldbuild');
    expect(deleted).toContain('trip-images-v0');
    // Someone else's → untouched. Deleting these leaves the sibling app with no
    // precache and no way to rebuild it until its own next version bump.
    expect(deleted).not.toContain('sibling-app-shell-v3');
    expect(deleted).not.toContain('workbox-precache-v2-https://powan55.github.io/other/');
    // Current set survives.
    expect(deleted).not.toContain(PRECACHE);
    expect(deleted).not.toContain(IMAGES_CACHE);
    expect(deleted).not.toContain(FRANKFURTER_CACHE);
  });
});

describe('navigation: offline, an in-app link resolves to its own route shell', () => {
  const shells = {
    [PRECACHE]: { '/': 'HOME_SHELL', '/404.html': 'NOT_FOUND', '/plan/': 'PLAN_SHELL' },
  };
  const offline = async () => {
    throw new TypeError('Failed to fetch');
  };

  // Next fetches a route's RSC payload from <route>/index.txt; offline that fetch
  // fails and Next HARD-NAVIGATES to the .txt URL itself. Without the suffix strip
  // the nav handler misses and answers with the app-root shell, so tapping "Plan"
  // offline renders Home at /plan/index.txt and every further tap repeats it.
  it('serves the Plan shell for a navigation to /plan/index.txt', async () => {
    const { caches } = makeCaches(shells);
    const handlers = instantiate(caches, offline);
    const res = await runFetch(
      handlers,
      makeRequest('/plan/index.txt', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.body).toBe('PLAN_SHELL');
  });

  it('serves the Plan shell for the no-trailing-slash form, /plan.txt', async () => {
    const { caches } = makeCaches(shells);
    const handlers = instantiate(caches, offline);
    const res = await runFetch(
      handlers,
      makeRequest('/plan.txt', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.body).toBe('PLAN_SHELL');
  });

  it('still serves the plain route URL from cache', async () => {
    const { caches } = makeCaches(shells);
    const handlers = instantiate(caches, offline);
    const res = await runFetch(
      handlers,
      makeRequest('/plan/', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.body).toBe('PLAN_SHELL');
  });

  // Control: the Home fallback is still reachable, so the assertions above are
  // proving a real route match rather than a handler that answers PLAN_SHELL always.
  it('falls back to the Home shell for a route that was never precached', async () => {
    const { caches } = makeCaches(shells);
    const handlers = instantiate(caches, offline);
    const res = await runFetch(
      handlers,
      makeRequest('/never-precached/index.txt', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.body).toBe('HOME_SHELL');
  });
});

describe('static assets: the _rsc cache-buster does not multiply cache entries', () => {
  it('stores one entry per route and hits it from a different _rsc digest', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    let fetches = 0;
    const handlers = instantiate(caches, async () => {
      fetches++;
      return new FakeResponse('RSC_PAYLOAD', { contentType: 'text/x-component' });
    });

    // Next derives _rsc from the CURRENT router state tree, so the same target route
    // yields a different URL per source route and again for prefetch vs navigation.
    await runFetch(handlers, makeRequest('/plan/index.txt?_rsc=aaa111'));
    await runFetch(handlers, makeRequest('/plan/index.txt?_rsc=bbb222'));
    await runFetch(handlers, makeRequest('/plan/index.txt?_rsc=ccc333'));

    expect(put.map((p) => p.key)).toEqual(['/plan/index.txt']);
    expect(fetches).toBe(1); // 2nd and 3rd were cache hits under the normalized key
  });

  // A .txt payload drops its WHOLE search string, not just _rsc. Next mutates only the
  // PATHNAME when it derives the payload URL, so `components/command-palette.tsx`'s
  // router.push('/plan/?focus=<id>') is fetched as /plan/index.txt?focus=<id>&_rsc=<digest>.
  // Deleting _rsc alone leaves ?focus=<id> in the key, which matches nothing: the
  // precached entry is the bare /plan/index.txt, and it is the only one that exists.
  // Offline that miss is Next's MPA fallback — a hard reload — so the precached payloads
  // would be dead weight for exactly the deep links.
  it('drops the whole search on a .txt payload, so a query-carrying link still hits the precached entry', async () => {
    const { caches } = makeCaches({ [PRECACHE]: { '/plan/index.txt': 'PLAN_RSC_PAYLOAD' } });
    let fetches = 0;
    const handlers = instantiate(caches, async () => {
      fetches++;
      throw new TypeError('Failed to fetch'); // offline: only the cache can answer
    });

    const res = await runFetch(handlers, makeRequest('/plan/index.txt?focus=abc123&_rsc=aaa111'));

    expect(res?.body).toBe('PLAN_RSC_PAYLOAD');
    expect(fetches).toBe(0);
  });

  // The export writes a full segment tree under every route, so the ROOT-LAYOUT payload
  // `__next._index.txt` is emitted once per route — 20 files, one md5. Only the root copy is
  // precached; the other 19 URLs are rewritten onto it here, which is what makes dropping them
  // from the install list safe. Off by one line and those 19 prefetches miss offline instead.
  it("serves every route's __next._index.txt from the single precached root entry", async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: { '/__next._index.txt': 'ROOT_LAYOUT_PAYLOAD' } });
    let fetches = 0;
    const handlers = instantiate(caches, async () => {
      fetches++;
      throw new TypeError('Failed to fetch'); // offline: only the cache can answer
    });

    for (const url of [
      '/plan/__next._index.txt',
      '/travel/__next._index.txt?_rsc=aaa111',
      '/_not-found/__next._index.txt',
      '/__next._index.txt',
    ]) {
      const res = await runFetch(handlers, makeRequest(url));
      expect(res?.body).toBe('ROOT_LAYOUT_PAYLOAD');
    }
    expect(fetches).toBe(0);
    expect(put).toEqual([]); // and no second copy is written back under a per-route key
  });

  // The sibling segment payloads are per-route and all differ, so they keep their own keys.
  it('does not rewrite the per-route _tree / __PAGE__ payloads', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    const handlers = instantiate(
      caches,
      async () => new FakeResponse('SEGMENT', { contentType: 'text/x-component' })
    );
    await runFetch(handlers, makeRequest('/plan/__next._tree.txt?_rsc=aaa111'));
    await runFetch(handlers, makeRequest('/plan/__next.plan.__PAGE__.txt'));
    expect(put.map((p) => p.key)).toEqual([
      '/plan/__next._tree.txt',
      '/plan/__next.plan.__PAGE__.txt',
    ]);
  });

  // The scoping is the other half of the contract: dropping every param is sound ONLY
  // for a static export's .txt, whose bytes are prerendered per route and cannot vary by
  // query. `/api/thing?page=2` keeps its page — a param there selects the bytes.
  it('leaves a URL without _rsc, and other query params, alone', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    const handlers = instantiate(
      caches,
      async () => new FakeResponse('CHUNK', { contentType: 'text/javascript' })
    );
    await runFetch(handlers, makeRequest('/_next/static/chunks/app-1234abcd.js'));
    await runFetch(handlers, makeRequest('/api/thing?page=2&_rsc=zzz'));
    expect(put.map((p) => p.key)).toEqual(['/_next/static/chunks/app-1234abcd.js', '/api/thing?page=2']);
  });
});

describe('images: the content-hashed precache wins over the durable runtime cache', () => {
  const request = makeRequest('/images/hero/hero.avif', { destination: 'image' });

  it('serves the precached copy, not the stale trip-images-v1 one, and skips the network', async () => {
    // trip-images-v1 is never versioned and is allowlisted through every activate,
    // while /images/** filenames are not content-hashed — so the runtime copy is the
    // one that goes stale, and the fresh bytes sit in the new precache.
    const { caches } = makeCaches({
      [PRECACHE]: { '/images/hero/hero.avif': 'FRESH_HERO' },
      [IMAGES_CACHE]: { '/images/hero/hero.avif': 'STALE_HERO' },
    });
    let fetches = 0;
    const handlers = instantiate(caches, async () => {
      fetches++;
      return new FakeResponse('NETWORK_HERO', { contentType: 'image/avif' });
    });

    const res = await runFetch(handlers, request);
    expect(res?.body).toBe('FRESH_HERO');
    expect(fetches).toBe(0);
  });

  it('still serves a runtime-cached image the build never precached', async () => {
    const { caches } = makeCaches({
      [PRECACHE]: {},
      [IMAGES_CACHE]: { '/images/gallery/kyoto.avif': 'GALLERY' },
    });
    const handlers = instantiate(caches, async () => new FakeResponse('NETWORK', { contentType: 'image/avif' }));
    const res = await runFetch(handlers, makeRequest('/images/gallery/kyoto.avif', { destination: 'image' }));
    expect(res?.body).toBe('GALLERY');
  });
});

describe('a rejecting Cache Storage degrades, it does not take the response down', () => {
  // An exception inside respondWith rejects the response and the browser paints its
  // network-error page — for a route the precache is holding.
  it('navigation: falls through to the network instead of rejecting', async () => {
    const { caches } = makeCaches({ [PRECACHE]: { '/plan/': 'PLAN_SHELL' } }, { rejectMatch: true });
    const handlers = instantiate(caches, async () => new FakeResponse('FROM_NETWORK'));
    const res = await runFetch(
      handlers,
      makeRequest('/plan/', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.body).toBe('FROM_NETWORK');
  });

  it('navigation, and offline too: resolves with an error response rather than throwing', async () => {
    const { caches } = makeCaches({ [PRECACHE]: { '/': 'HOME_SHELL' } }, { rejectMatch: true });
    const handlers = instantiate(caches, async () => {
      throw new TypeError('Failed to fetch');
    });
    const res = await runFetch(
      handlers,
      makeRequest('/plan/', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.type).toBe('error');
  });

  it('static asset: still returns the network response', async () => {
    const { caches } = makeCaches({ [PRECACHE]: {} }, { rejectMatch: true });
    const handlers = instantiate(
      caches,
      async () => new FakeResponse('CHUNK', { contentType: 'text/javascript' })
    );
    const res = await runFetch(handlers, makeRequest('/_next/static/chunks/app-1234abcd.js'));
    expect(res?.body).toBe('CHUNK');
  });

  it('image: falls back to the network response rather than throwing', async () => {
    const { caches } = makeCaches({ [PRECACHE]: {} }, { rejectMatch: true });
    const handlers = instantiate(
      caches,
      async () => new FakeResponse('NETWORK_IMG', { contentType: 'image/avif' })
    );
    const res = await runFetch(handlers, makeRequest('/images/x.avif', { destination: 'image' }));
    expect(res?.body).toBe('NETWORK_IMG');
  });
});
