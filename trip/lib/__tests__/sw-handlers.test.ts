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
import { precacheRevision } from '../../scripts/gen-sw.mjs';

// ---------------------------------------------------------------------------
// Lift the worker template out of the generator and instantiate it.

const ORIGIN = 'https://example.test';
const PRECACHE = 'trip-precache-testhash';
const IMAGES_CACHE = 'trip-images-v1';
const FRANKFURTER_CACHE = 'trip-frankfurter-v1';
const NAV_FALLBACK = '/';
const OWN_CHUNK = '/_next/static/chunks/app-1234abcd.js';
const PAYLOAD = '/plan/index.txt';
const PRECACHE_URLS = ['/', '/404.html', '/plan/', '/travel/', '/images/hero/hero.avif', OWN_CHUNK, PAYLOAD];
const BUILD_ID = 'BUILD_OWN';
const RUNTIME_CACHE = 'trip-runtime-testhash';
const ENGINE_CHUNK = '/_next/static/chunks/engine0000000000.js';
const RUNTIME_URLS = [ENGINE_CHUNK, '/maplibre/maplibre-gl-worker.mjs'];
const PRECACHE_LIST = '/__precache-urls.json';
const HERO = '/images/hero/hero.avif';
// Route pages never get a revision from the generator; '/plan/' has one here to prove the
// worker refuses to reuse a page even if one slipped into the map.
const PRECACHE_REVISIONS: Record<string, string> = {
  [OWN_CHUNK]: precacheRevision('x.js', Buffer.from('CHUNK'))!,
  [HERO]: precacheRevision('x.avif', Buffer.from('HERO'))!,
  '/plan/': precacheRevision('x.js', Buffer.from('OLDPLAN'))!,
};

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
    'buildId',
    'RUNTIME_CACHE_NAME',
    'runtimeUrls',
    'precacheRevisions',
    'return `' + template + '`'
  )(PRECACHE, IMAGES_CACHE, 80, NAV_FALLBACK, PRECACHE_URLS, (p: string) => p, BUILD_ID, RUNTIME_CACHE, RUNTIME_URLS, PRECACHE_REVISIONS);
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
    init: { ok?: boolean; status?: number; type?: string; contentType?: string; date?: string } = {}
  ) {
    this.body = body;
    this.ok = init.ok ?? true;
    this.status = init.status ?? 200;
    this.type = init.type ?? 'basic';
    this.redirected = false;
    const contentType = init.contentType ?? 'text/html';
    this.headers = {
      get: (n) =>
        n.toLowerCase() === 'content-type' ? contentType : n.toLowerCase() === 'date' ? (init.date ?? null) : null,
    };
  }

  clone(): FakeResponse {
    return this;
  }

  async text(): Promise<string> {
    return this.body;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new TextEncoder().encode(this.body).buffer as ArrayBuffer;
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
    keys(): Promise<{ url: string }[]>;
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
    for (const [k, body] of Object.entries(entries)) {
      const page = k.endsWith('/') || k.endsWith('.html');
      store.set(keyOf(k), new FakeResponse(body, { contentType: page ? 'text/html' : 'application/octet-stream' }));
    }
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
          // Cache.keys() yields Requests with absolute URLs.
          return [...store.keys()].map((k) => ({ url: ORIGIN + k }));
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
  fetchImpl: (req: Keyish) => Promise<FakeResponse>,
  registration: { waiting?: unknown; installing?: unknown } = {},
  cryptoImpl: unknown = globalThis.crypto
): Handlers {
  const handlers: Handlers = {};
  const self = {
    addEventListener: (t: keyof Handlers, cb: (e: unknown) => void) => {
      handlers[t] = cb;
    },
    location: { origin: ORIGIN },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    registration: { installing: null, waiting: null, update: async () => {}, ...registration },
  };
  new Function('self', 'caches', 'fetch', 'Response', 'location', 'crypto', WORKER_SOURCE)(
    self,
    caches,
    fetchImpl,
    FakeResponse,
    { origin: ORIGIN, href: ORIGIN + '/' },
    cryptoImpl
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
    const background: Promise<unknown>[] = [];
    const event = {
      request,
      waitUntil: (p: Promise<unknown>) => {
        background.push(p);
      },
      respondWith: (p: Promise<FakeResponse>) => {
        responded = true;
        Promise.resolve(p).then(
          // flush a macrotask so fire-and-forget cache writes settle
          (res) => Promise.all(background).then(() => setTimeout(() => resolve(res), 0)),
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
    // Retired with the Frankfurter handler (#980): a returning client drops it.
    expect(deleted).toContain(FRANKFURTER_CACHE);
  });
});

describe('fx rate: the worker leaves api.frankfurter.dev to the page (#980)', () => {
  // A cached 200 reads as a fresh fetch to fetchCurrencyRate; passing through lets a
  // dead network reject so the client's localStorage fallback marks the rate stale.
  const fx = () => makeRequest('https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY');

  it('passes the request through even with a cached copy present', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {}, [FRANKFURTER_CACHE]: { [fx().url]: 'OLD_RATE' } });
    const handlers = instantiate(caches, async () => new FakeResponse('NEW_RATE'));
    expect(await runFetch(handlers, fx())).toBeUndefined();
    expect(put).toEqual([]);
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

  // A path the build never shipped must not render Home under a 200 (#807).
  it('serves the 404 page for a route that was never precached', async () => {
    const { caches } = makeCaches(shells);
    const handlers = instantiate(caches, offline);
    const res = await runFetch(
      handlers,
      makeRequest('/never-precached/index.txt', { mode: 'navigate', destination: 'document' })
    );
    expect(res?.body).toBe('NOT_FOUND');
  });

  // Control: a shipped route whose entry was evicted still gets the Home shell.
  it('falls back to the Home shell for a shipped route whose entry was evicted', async () => {
    const { caches } = makeCaches({ [PRECACHE]: { '/': 'HOME_SHELL', '/404.html': 'NOT_FOUND' } });
    const handlers = instantiate(caches, offline);
    const res = await runFetch(
      handlers,
      makeRequest('/travel/', { mode: 'navigate', destination: 'document' })
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

  const gallery = () => makeRequest('/images/gallery/kyoto.avif', { destination: 'image' });
  const stale = new Date(Date.now() - 30 * 86400_000).toUTCString();
  const fresh = new Date().toUTCString();

  function seeded(date: string) {
    const made = makeCaches({ [PRECACHE]: {}, [IMAGES_CACHE]: {} });
    made.stores
      .get(IMAGES_CACHE)!
      .set('/images/gallery/kyoto.avif', new FakeResponse('OLD', { contentType: 'image/avif', date }));
    return made;
  }

  it('serves a stale gallery image at once and refreshes it in the background', async () => {
    const { caches, stores } = seeded(stale);
    const handlers = instantiate(caches, async () => new FakeResponse('NEW', { contentType: 'image/avif' }));
    const res = await runFetch(handlers, gallery());
    expect(res?.body).toBe('OLD');
    expect(stores.get(IMAGES_CACHE)!.get('/images/gallery/kyoto.avif')?.body).toBe('NEW');
  });

  it('does not refetch a fresh gallery image', async () => {
    const { caches } = seeded(fresh);
    let fetches = 0;
    const handlers = instantiate(caches, async () => {
      fetches++;
      return new FakeResponse('NEW', { contentType: 'image/avif' });
    });
    expect((await runFetch(handlers, gallery()))?.body).toBe('OLD');
    expect(fetches).toBe(0);
  });

  it('offline, a stale gallery image still serves and stays cached', async () => {
    const { caches, stores } = seeded(stale);
    const handlers = instantiate(caches, async () => {
      throw new TypeError('offline');
    });
    expect((await runFetch(handlers, gallery()))?.body).toBe('OLD');
    expect(stores.get(IMAGES_CACHE)!.get('/images/gallery/kyoto.avif')?.body).toBe('OLD');
  });

  it('overlapping misses trim to exactly the cap, oldest first', async () => {
    const full: Record<string, string> = {};
    for (let i = 0; i < 80; i++) full[`/images/gallery/old${i}.avif`] = 'x';
    const { caches, stores } = makeCaches({ [PRECACHE]: {}, [IMAGES_CACHE]: full });
    const handlers = instantiate(caches, async () => new FakeResponse('N', { contentType: 'image/avif' }));
    await Promise.all(
      [0, 1, 2].map((i) => runFetch(handlers, makeRequest(`/images/gallery/new${i}.avif`, { destination: 'image' })))
    );
    const keys = [...stores.get(IMAGES_CACHE)!.keys()];
    expect(keys).toHaveLength(80);
    expect(keys).not.toContain('/images/gallery/old2.avif');
    expect(keys).toContain('/images/gallery/old3.avif');
    expect(keys).toContain('/images/gallery/new2.avif');
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

describe('repair: a precache emptied under a live registration refills itself (#758)', () => {
  const runRepair = (handlers: Handlers) =>
    new Promise<void>((res, rej) => {
      handlers.message!({
        data: { type: 'REPAIR' },
        waitUntil: (p: Promise<unknown>) => Promise.resolve(p).then(() => res(), rej),
      });
    });
  const ownPage = `<script src="/base${OWN_CHUNK}"></script>"buildId":"${BUILD_ID}"`;
  const ownPayload = `0:{"b":"${BUILD_ID}"}`;
  const network = (html: string, txt = ownPayload) => async (req: Keyish) => {
    const k = keyOf(req);
    if (k.endsWith('.js')) return new FakeResponse('CHUNK', { contentType: 'text/javascript' });
    if (k.endsWith('.avif')) return new FakeResponse('HERO', { contentType: 'image/avif' });
    if (k.endsWith('.txt')) return new FakeResponse(txt, { contentType: 'text/x-component' });
    return new FakeResponse(html);
  };
  const putKeys = (put: Array<{ key: string }>) =>
    put.map((p) => p.key).filter((k) => k !== PRECACHE_LIST).sort();

  it('writes the precache list the preflight check compares against', async () => {
    const { caches, stores } = makeCaches({ [PRECACHE]: {} });
    await runRepair(instantiate(caches, network(ownPage)));
    expect(JSON.parse(stores.get(PRECACHE)!.get(PRECACHE_LIST)!.body)).toEqual(PRECACHE_URLS);
  });

  it('refetches only the missing entries and leaves the rest alone', async () => {
    const { caches, put, stores } = makeCaches({
      [PRECACHE]: { '/': 'HOME', '/404.html': 'NF', '/travel/': 'TRAVEL', '/images/hero/hero.avif': 'H' },
    });
    await runRepair(instantiate(caches, network(ownPage)));
    expect(putKeys(put)).toEqual([OWN_CHUNK, '/plan/', PAYLOAD]);
    expect(stores.get(PRECACHE)!.get('/plan/')!.body).toBe(ownPage);
    expect(stores.get(PRECACHE)!.get('/')!.body).toBe('HOME');
  });

  it('refuses a captive-portal page', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    await runRepair(instantiate(caches, network('<html>Sign in to Wi-Fi</html>')));
    expect(putKeys(put)).toEqual([OWN_CHUNK, '/images/hero/hero.avif', PAYLOAD]);
  });

  // Hashed chunks survive across builds, so loading one of ours proves nothing.
  it('refuses a page from a newer build even when it loads one of our chunks', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    await runRepair(
      instantiate(caches, network(`<script src="${OWN_CHUNK}"></script>"buildId":"BUILD_NEWER"`))
    );
    expect(putKeys(put)).toEqual([OWN_CHUNK, '/images/hero/hero.avif', PAYLOAD]);
  });

  it('refuses an RSC payload from a newer build', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    await runRepair(instantiate(caches, network(ownPage, '0:{"b":"BUILD_NEWER"}')));
    expect(putKeys(put)).not.toContain(PAYLOAD);
    expect(putKeys(put)).toContain('/plan/');
  });

  for (const pending of ['waiting', 'installing'] as const) {
    it(`does nothing while a newer worker is ${pending}`, async () => {
      const { caches, put } = makeCaches({ [PRECACHE]: {} });
      let fetches = 0;
      const handlers = instantiate(
        caches,
        async (req) => {
          fetches++;
          return network(ownPage)(req);
        },
        { [pending]: {} }
      );
      await runRepair(handlers);
      expect(put).toEqual([]);
      expect(fetches).toBe(0);
    });
  }
});

describe('install: refuses a mixed-build edge and cleans up after itself (#944, #945)', () => {
  const runInstall = (handlers: Handlers) =>
    new Promise<unknown>((res) => {
      handlers.install!({
        waitUntil: (p: Promise<unknown>) => Promise.resolve(p).then(() => res('installed'), (err) => res(err)),
      });
    });
  const network = (plan: string) => async (req: Keyish) => {
    const k = keyOf(req);
    if (k.endsWith('.js')) return new FakeResponse('CHUNK', { contentType: 'text/javascript' });
    if (k.endsWith('.avif')) return new FakeResponse('HERO', { contentType: 'image/avif' });
    if (k.endsWith('.txt')) return new FakeResponse(`0:{"b":"${BUILD_ID}"}`, { contentType: 'text/x-component' });
    return new FakeResponse(k === '/plan/' ? plan : `"buildId":"${BUILD_ID}"`);
  };

  it('installs a consistent build and writes the precache list last', async () => {
    const { caches, stores, put } = makeCaches({});
    expect(await runInstall(instantiate(caches, network(`"buildId":"${BUILD_ID}"`)))).toBe('installed');
    expect(put.at(-1)!.key).toBe(PRECACHE_LIST);
    expect(stores.get(PRECACHE)!.size).toBe(PRECACHE_URLS.length + 1);
  });

  it('rejects route HTML from the previous build and deletes the half-filled cache', async () => {
    const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': { '/plan/': 'OLD' } });
    const result = await runInstall(instantiate(caches, network('"buildId":"BUILD_OLD"')));
    expect(result).toBeInstanceOf(Error);
    expect(stores.has(PRECACHE)).toBe(false);
    expect(stores.get('trip-precache-oldbuild')!.get('/plan/')!.body).toBe('OLD');
  });

  it('a failed install leaves an existing cache of the same name alone', async () => {
    const { caches, deleted } = makeCaches({ [PRECACHE]: { '/': 'LIVE' } });
    const result = await runInstall(instantiate(caches, network('"buildId":"BUILD_OLD"')));
    expect(result).toBeInstanceOf(Error);
    expect(deleted).toEqual([]);
  });

  describe('reuses byte-identical entries from an older precache (#979)', () => {
    const ok = `"buildId":"${BUILD_ID}"`;
    const counting = (plan: string) => {
      const fetched: string[] = [];
      const impl = async (req: Keyish) => {
        fetched.push(keyOf(req));
        return network(plan)(req);
      };
      return { fetched, impl };
    };

    it('copies unchanged entries and fetches only the rest', async () => {
      const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': { [OWN_CHUNK]: 'CHUNK', [HERO]: 'HERO' } });
      const { fetched, impl } = counting(ok);
      expect(await runInstall(instantiate(caches, impl))).toBe('installed');
      expect(fetched.sort()).toEqual(['/', '/404.html', '/plan/', '/travel/', PAYLOAD].sort());
      expect(stores.get(PRECACHE)!.get(OWN_CHUNK)!.body).toBe('CHUNK');
      expect(stores.get(PRECACHE)!.size).toBe(PRECACHE_URLS.length + 1);
    });

    it('fetches an entry whose stored bytes no longer match', async () => {
      const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': { [OWN_CHUNK]: 'CHUNK_V1', [HERO]: 'HERO' } });
      const { fetched, impl } = counting(ok);
      expect(await runInstall(instantiate(caches, impl))).toBe('installed');
      expect(fetched).toContain(OWN_CHUNK);
      expect(fetched).not.toContain(HERO);
      expect(stores.get(PRECACHE)!.get(OWN_CHUNK)!.body).toBe('CHUNK');
    });

    it('never reuses a page, even one with a matching revision', async () => {
      const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': { '/plan/': 'OLDPLAN' } });
      const { fetched, impl } = counting(ok);
      expect(await runInstall(instantiate(caches, impl))).toBe('installed');
      expect(fetched).toContain('/plan/');
      expect(stores.get(PRECACHE)!.get('/plan/')!.body).toBe(ok);
    });

    it('ignores caches that are not ours', async () => {
      const { caches } = makeCaches({ 'other-app-v1': { [OWN_CHUNK]: 'CHUNK' } });
      const { fetched, impl } = counting(ok);
      expect(await runInstall(instantiate(caches, impl))).toBe('installed');
      expect(fetched).toContain(OWN_CHUNK);
    });

    it('a rejecting cache lookup falls back to the network for every entry', async () => {
      const { caches, stores } = makeCaches(
        { 'trip-precache-oldbuild': { [OWN_CHUNK]: 'CHUNK', [HERO]: 'HERO' } },
        { rejectMatch: true }
      );
      const { fetched, impl } = counting(ok);
      expect(await runInstall(instantiate(caches, impl))).toBe('installed');
      expect(fetched).toContain(OWN_CHUNK);
      expect(fetched).toContain(HERO);
      expect(stores.get(PRECACHE)!.size).toBe(PRECACHE_URLS.length + 1);
    });

    it('a throwing digest falls back to the network for every entry', async () => {
      const old = { [OWN_CHUNK]: 'CHUNK', [HERO]: 'HERO' };
      const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': old });
      const { fetched, impl } = counting(ok);
      const broken = { subtle: { digest: async () => { throw new Error('no subtle'); } } };
      expect(await runInstall(instantiate(caches, impl, {}, broken))).toBe('installed');
      expect(fetched.sort()).toEqual([...PRECACHE_URLS].sort());
      for (const url of [OWN_CHUNK, HERO]) {
        expect(stores.get(PRECACHE)!.get(url)).not.toBe(stores.get('trip-precache-oldbuild')!.get(url));
      }
    });

    it('does not copy a stored entry the install guards would refuse', async () => {
      const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': {} });
      stores.get('trip-precache-oldbuild')!.set(OWN_CHUNK, new FakeResponse('CHUNK', { contentType: 'text/html' }));
      const { fetched, impl } = counting(ok);
      expect(await runInstall(instantiate(caches, impl))).toBe('installed');
      expect(fetched).toContain(OWN_CHUNK);
    });

    it('a retry after a failed install fetches only what the failed attempt missed', async () => {
      const { caches, stores } = makeCaches({});
      const first = counting(ok);
      const flaky = async (req: Keyish) => {
        first.fetched.push(keyOf(req));
        if (keyOf(req) === '/travel/') throw new TypeError('network down');
        return network(ok)(req);
      };
      expect(await runInstall(instantiate(caches, flaky))).toBeInstanceOf(Error);
      expect(first.fetched.sort()).toEqual([...PRECACHE_URLS].sort());
      expect(stores.has(PRECACHE)).toBe(false);
      expect([...stores.get('trip-install-partial')!.keys()].sort()).toEqual([HERO, OWN_CHUNK].sort());

      const retry = counting(ok);
      expect(await runInstall(instantiate(caches, retry.impl))).toBe('installed');
      expect(retry.fetched.sort()).toEqual(['/', '/404.html', '/plan/', '/travel/', PAYLOAD].sort());
      expect(stores.get(PRECACHE)!.size).toBe(PRECACHE_URLS.length + 1);
      expect(stores.has('trip-install-partial')).toBe(false);
    });

    it('a BUILD_ID mismatch rejects the install and leaves the old precache intact', async () => {
      const { caches, stores } = makeCaches({ 'trip-precache-oldbuild': { [OWN_CHUNK]: 'CHUNK', [HERO]: 'HERO' } });
      const result = await runInstall(instantiate(caches, network('"buildId":"BUILD_OLD"')));
      expect(result).toBeInstanceOf(Error);
      expect(stores.has(PRECACHE)).toBe(false);
      expect(stores.get('trip-precache-oldbuild')!.get(OWN_CHUNK)!.body).toBe('CHUNK');
    });
  });
});

describe('precacheRevision: pages and payloads are never reusable', () => {
  it('skips html and txt, hashes everything else', () => {
    expect(precacheRevision('plan/index.html', Buffer.from('x'))).toBeNull();
    expect(precacheRevision('plan/__next._tree.txt', Buffer.from('x'))).toBeNull();
    expect(precacheRevision('_next/static/chunks/a-1234abcd.js', Buffer.from('x'))).toMatch(/^[0-9a-f]{32}$/);
    expect(precacheRevision('icons/icon-192.png', Buffer.from('a'))).not.toBe(
      precacheRevision('icons/icon-192.png', Buffer.from('b'))
    );
  });
});

describe('runtime cache: the map engine survives an update (#945)', () => {
  it('writes a runtime-only asset to the runtime cache, not the per-build precache', async () => {
    const { caches, put } = makeCaches({ [PRECACHE]: {} });
    const handlers = instantiate(caches, async () => new FakeResponse('ENGINE', { contentType: 'text/javascript' }));
    await runFetch(handlers, makeRequest(ENGINE_CHUNK));
    await runFetch(handlers, makeRequest('/plan/__next._full.txt'));
    expect(put).toEqual([
      { cache: RUNTIME_CACHE, key: ENGINE_CHUNK },
      { cache: PRECACHE, key: '/plan/__next._full.txt' },
    ]);
  });

  it('activate keeps the runtime cache and prunes what this build no longer ships', async () => {
    const { caches, deleted, stores } = makeCaches({
      [PRECACHE]: {},
      'trip-precache-oldbuild': {},
      [RUNTIME_CACHE]: { [ENGINE_CHUNK]: 'ENGINE', '/_next/static/chunks/gone1111111111.js': 'OLD' },
      'trip-runtime-oldmaplibre': { [ENGINE_CHUNK]: 'ENGINE_V5' },
    });
    const handlers = instantiate(caches, async () => new FakeResponse('x'));
    await new Promise<void>((res, rej) => {
      handlers.activate!({ waitUntil: (p: Promise<unknown>) => Promise.resolve(p).then(() => res(), rej) });
    });
    expect(deleted).toEqual(expect.arrayContaining(['trip-precache-oldbuild', 'trip-runtime-oldmaplibre']));
    expect(deleted).not.toContain(RUNTIME_CACHE);
    expect([...stores.get(RUNTIME_CACHE)!.keys()]).toEqual([ENGINE_CHUNK]);
  });
});
