# X Bookmark Injector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chromium MV3 extension that pins one random un-cleared X bookmark at the top of the For You feed on each Home load, with save-rank + timestamp + count-left, and Done (real delete)/Keep (local) actions.

**Architecture:** Pure, framework-free core modules (ranking/selection/merge/count/normalize) are unit-tested with Vitest and imported by the extension surfaces. `inpage.js` (MAIN world) captures auth and executes GraphQL in X's own page context so session cookies are reliable; `content.js` (ISOLATED world) bridges page messages, injects the card, and observes the timeline; `background.js` (service worker) orchestrates sync and owns persisted state; `popup` is the dashboard. esbuild bundles `src/` → `dist/`; the unpacked extension loads from `dist/`.

**Tech Stack:** JavaScript (ES modules), esbuild (bundler), Vitest (tests), Chrome MV3 APIs (`chrome.storage.local`, service worker, content scripts), X internal GraphQL.

## Global Constraints

- Target: **Chromium MV3 only**; host permissions limited to `https://x.com/*` and `https://twitter.com/*` + `storage`. No `<all_urls>`.
- **Local-only:** all state in `chrome.storage.local`; network calls only to `x.com`. No backend/telemetry.
- **Fetch strategy:** intercept + replay the app's own auth/templates in MAIN world; never commit a Bearer/cookie fallback.
- **Save rank:** `#1 = oldest saved`, `#N = newest saved` (reverse of X's LIFO order). Order is reliable; never fabricate exact "bookmarked-at" time.
- **Count left:** `total − (cleared where action==="done")`. "Keep" does NOT decrement.
- **Card:** Hybrid style, pinned as the first cell of For You on each Home load. Reference: `docs/mockups/2026-07-10-injected-card-directions.html`.
- **Done** → real `DeleteBookmark` (one-time confirm + Undo via `CreateBookmark`). **Keep** → local dismiss + `settings.keepCooldownHours` (default 72).
- TDD for all pure core; DRY; YAGNI; frequent commits. Node ≥ 18.
- Spec: `docs/superpowers/specs/2026-07-10-x-bookmark-injector-design.md`.

---

## File Structure

```
x-bookmark-injector/
├── manifest.json                 # MV3 manifest (source; copied to dist/)
├── package.json                  # esbuild + vitest scripts
├── build.mjs                     # esbuild bundle + static copy → dist/
├── vitest.config.js
├── public/
│   └── popup.html
├── src/
│   ├── core/                     # PURE, unit-tested, no chrome/DOM deps
│   │   ├── normalize.js          # normalizeTweet(raw) -> Bookmark
│   │   ├── ranking.js            # assignSaveRank(bookmarksNewestFirst) -> withRank
│   │   ├── merge.js              # mergeBookmarks(existing, incoming) -> merged
│   │   ├── count.js              # countLeft(bookmarks, cleared) -> int
│   │   └── selection.js          # pickBookmark(bookmarks, cleared, now, rng) -> Bookmark|null
│   ├── x-api/
│   │   ├── graphql.js            # buildBookmarksRequest / parseBookmarks / buildMutationRequest
│   │   └── constants.js          # endpoints + operation names (no committed secrets)
│   ├── bridge.js                 # request/response protocol shared by page/content/background
│   ├── storage.js                # chrome.storage.local get/set helpers + defaults
│   ├── selectors.js              # centralized DOM selectors for x.com
│   ├── ui/card.js                # buildCardElement(bookmark, stats, handlers)
│   ├── inpage.js                 # MAIN world: capture auth -> postMessage
│   ├── content.js                # ISOLATED world: observer + inject + actions
│   ├── background.js             # service worker: sync + message router
│   └── popup.js                  # dashboard logic
├── tests/
│   ├── normalize.test.js
│   ├── ranking.test.js
│   ├── merge.test.js
│   ├── count.test.js
│   ├── selection.test.js
│   ├── graphql.test.js
│   ├── storage.test.js
│   ├── card.test.js
│   ├── bridge.test.js
│   ├── sync.test.js
│   └── selectors.test.js
├── fixtures/
│   └── bookmarks-response.json   # trimmed real-shape GraphQL response
├── dist/                         # build output (gitignored) — load this as unpacked
└── README.md
```

**Milestone mapping:** M1=Tasks 1–2 (setup + static card) · M2=Task 11 (auth capture + page executor) · M3=Tasks 3–9 and 12 (core + api + storage + sync) · M4=Task 10 (real card) · M5=Task 12 (actions) · M6=Tasks 13–14 (popup + hardening).

## Unknown-Unknown Register (MOTS)

These are resolved as explicit spikes or gates, not silently assumed:

| Unknown | Blast radius | Resolution | Gate / surviving artifact |
|---|---|---|---|
| X rotates GraphQL `queryId`s and response shapes | Read/delete can stop entirely | Capture live operation URLs and headers in MAIN world; parser accepts known timeline entry variants | Task 11 capture fixture + Task 8 parser tests; captured operation map survives in memory, last-known `queryIds` in storage |
| Extension/service-worker cookie semantics for X | Sync may authenticate in DevTools but fail in MV3 | Execute replay requests in MAIN page world, not the service worker | Task 11 manual probe must return HTTP 200 from page executor before Task 12 |
| X may require fresh `x-client-transaction-id` | Mutations may return 401/403 | Capture full safe request headers per operation and replay the latest set; never fabricate the header | Task 11 records whether Delete/Create replay works; README documents break-glass recapture |
| X timeline selectors and For You detection drift | Card disappears or lands in wrong feed | Centralize selectors; detect Home + selected `For you` tab; fail closed | Task 2/14 manual selector checklist |
| Exact bookmark-save time is absent | UI could mislead the owner | Show only save-order rank and tweet-posted time; label both explicitly | Unit tests for rank; copy review in Task 10 |
| Real delete is destructive | User can lose a bookmark | One-time confirmation, only mark local Done after 2xx GraphQL success, 6s Undo via `CreateBookmark` | Task 12 action tests + manual real-account verification |
| Full backlog pagination may hit rate limits | Partial counts/ranks | Persist cursor during an in-progress sync, back off on 429, publish new cache only after complete pagination | Task 12 transactional-sync test; old cache survives failed sync |

**Loop contract:** Start = owner opens X Home or presses Sync. Free rein = read X bookmarks, cache locally, inject one card; writes require explicit Done/Undo. Proof = unit suite + build + real-account manual checklist. Unwind = unload extension; Undo re-creates a just-deleted bookmark; failed sync never replaces the prior cache. Survives = local bookmark cache, clear history, settings, tests, fixtures, and this plan.

---

<!-- TASKS: filled in below -->
## Task 1: Project setup, build pipeline, MV3 skeleton

**Files:**
- Create: `package.json`, `build.mjs`, `vitest.config.js`, `manifest.json`, `public/popup.html`, `src/inpage.js`, `src/content.js`, `src/background.js`, `src/popup.js`

**Interfaces:**
- Produces: `npm run build` → `dist/` (loadable unpacked extension); `npm test` runner.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "x-bookmark-injector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "test": "vitest run --passWithNoTests"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install deps**

Run: `npm install`
Expected: `node_modules/` created, esbuild + vitest present.

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
```

- [ ] **Step 4: Create `build.mjs`**

```js
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const entryPoints = ['src/inpage.js', 'src/content.js', 'src/background.js', 'src/popup.js'];
const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

async function copyStatic() {
  await cp('manifest.json', 'dist/manifest.json');
  await cp('public/popup.html', 'dist/popup.html');
}

const ctx = await esbuild.context({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  await copyStatic();
  console.log('watching src → dist/ ...');
} else {
  await ctx.rebuild();
  await copyStatic();
  await ctx.dispose();
  console.log('build complete → dist/');
}
```

- [ ] **Step 5: Create `manifest.json`** (icons added in Task 14; omitted now so it loads)

```json
{
  "manifest_version": 3,
  "name": "X Bookmark Injector",
  "version": "0.1.0",
  "description": "Pins a random saved X bookmark to the top of your For You feed so you read and clear them.",
  "permissions": ["storage"],
  "host_permissions": ["https://x.com/*", "https://twitter.com/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html", "default_title": "Bookmark Injector" },
  "content_scripts": [
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["inpage.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle",
      "world": "ISOLATED"
    }
  ]
}
```

- [ ] **Step 6: Create entry stubs**

`src/inpage.js`:
```js
// MAIN world. Auth interception implemented in Task 11.
console.debug('[xbi] inpage loaded');
```

`src/content.js`:
```js
// ISOLATED world. Card injection implemented in Task 2.
console.debug('[xbi] content loaded');
```

`src/background.js`:
```js
// Service worker. Sync + actions implemented in Task 12.
console.debug('[xbi] background loaded');
```

`src/popup.js`:
```js
// Dashboard logic implemented in Task 13.
console.debug('[xbi] popup loaded');
```

- [ ] **Step 7: Create `public/popup.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8" />
<style>body{width:280px;font:14px system-ui;margin:0;padding:14px;background:#000;color:#e7e9ea}</style>
</head><body>
  <h3 style="margin:0 0 8px">Bookmark Injector</h3>
  <div id="app">Loading…</div>
  <script src="popup.js"></script>
</body></html>
```

- [ ] **Step 8: Build and verify**

Run: `npm run build`
Expected: `build complete → dist/`; `dist/` contains `manifest.json`, `content.js`, `inpage.js`, `background.js`, `popup.js`, `popup.html`.

- [ ] **Step 9: Load unpacked + verify**

Manual: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`. Open `x.com` → DevTools console shows `[xbi] content loaded` and `[xbi] inpage loaded`.

- [ ] **Step 10: Commit**

```bash
git add package.json build.mjs vitest.config.js manifest.json public src
git commit -m "chore: MV3 skeleton, esbuild+vitest build pipeline"
```

## Task 2: Static injected card (M1 vertical slice)

**Files:**
- Modify: `src/content.js`
- Create: `src/selectors.js`

**Interfaces:**
- Produces: `findTimeline()` and `pinCard(el)` behavior; a static card node appears as the first item of For You. Task 10 replaces the static content with real data.

- [ ] **Step 1: Create `src/selectors.js`**

```js
// Centralized so DOM drift is fixed in one place (spec §12).
export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  timeline: '[aria-label^="Timeline"]',
  cell: '[data-testid="cellInnerDiv"]',
};
export const CARD_ID = 'xbi-card';
export function isHome() {
  return location.pathname === '/home';
}
```

- [ ] **Step 2: Implement static injection in `src/content.js`**

```js
import { SEL, CARD_ID, isHome } from './selectors.js';

function buildStaticCard() {
  const el = document.createElement('div');
  el.id = CARD_ID;
  el.setAttribute('data-testid', 'cellInnerDiv');
  el.style.cssText = 'padding:12px 16px;border-bottom:1px solid #2f3336;background:linear-gradient(180deg,#0b1016,#000);color:#e7e9ea;font:15px system-ui';
  el.innerHTML = `
    <div style="color:#1d9bf0;font-weight:700;font-size:12.5px;margin-bottom:4px">📌 From your bookmarks
      <span style="color:#71767b;font-weight:500">· static preview</span></div>
    <div>Injected card placeholder — real bookmark wired in Task 10.</div>`;
  return el;
}

function pinCard() {
  if (!isHome()) { removeCard(); return; }
  if (document.getElementById(CARD_ID)) return;         // no dup
  const timeline = document.querySelector(SEL.timeline);
  const firstCell = timeline?.querySelector(SEL.cell);
  if (!firstCell?.parentElement) return;                 // not ready yet
  firstCell.parentElement.insertBefore(buildStaticCard(), firstCell);
}

function removeCard() {
  document.getElementById(CARD_ID)?.remove();
}

const observer = new MutationObserver(() => pinCard());
observer.observe(document.body, { childList: true, subtree: true });

// SPA route changes: X uses pushState; re-evaluate on navigation.
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) { lastPath = location.pathname; pinCard(); }
}, 500);

pinCard();
console.debug('[xbi] content loaded');
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `build complete → dist/`.

- [ ] **Step 4: Manual verify**

Reload the unpacked extension, open `x.com/home`. Expected: a "📌 From your bookmarks — static preview" card sits at the very top of the For You feed; navigating to a profile removes it; returning to Home re-adds it; only one card (no duplicates while scrolling).

- [ ] **Step 5: Commit**

```bash
git add src/content.js src/selectors.js
git commit -m "feat: pin static bookmark card at top of For You (M1)"
```

## Task 3: Core — normalizeTweet

**Files:**
- Create: `src/core/normalize.js`, `tests/normalize.test.js`

**Interfaces:**
- Produces: `normalizeTweet(raw) -> Bookmark | null` where
  `Bookmark = { id, url, text, author, handle, avatar, createdAt, media: [{type,url}] }`.
  Consumed by Task 8 (parseBookmarks) and Task 12 (sync).

- [ ] **Step 1: Write the failing test** — `tests/normalize.test.js`

```js
import { describe, it, expect } from 'vitest';
import { normalizeTweet } from '../src/core/normalize.js';

const raw = {
  rest_id: '1806',
  legacy: {
    full_text: 'I hoard X bookmarks',
    created_at: 'Sat Jun 21 13:37:00 +0000 2026',
    extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/a.jpg' }] },
  },
  core: { user_results: { result: { legacy: {
    name: 'Zara Zhang', screen_name: 'zarazhangrui',
    profile_image_url_https: 'https://pbs.twimg.com/av.jpg',
  } } } },
};

describe('normalizeTweet', () => {
  it('maps a full tweet to a Bookmark', () => {
    expect(normalizeTweet(raw)).toEqual({
      id: '1806',
      url: 'https://x.com/zarazhangrui/status/1806',
      text: 'I hoard X bookmarks',
      author: 'Zara Zhang',
      handle: '@zarazhangrui',
      avatar: 'https://pbs.twimg.com/av.jpg',
      createdAt: '2026-06-21T13:37:00.000Z',
      media: [{ type: 'photo', url: 'https://pbs.twimg.com/a.jpg' }],
    });
  });
  it('defaults media to [] when absent', () => {
    const r = { rest_id: '9', legacy: { full_text: 'hi' }, core: { user_results: { result: { legacy: { screen_name: 'x' } } } } };
    expect(normalizeTweet(r).media).toEqual([]);
  });
  it('returns null when id is missing', () => {
    expect(normalizeTweet({ legacy: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/normalize.test.js`
Expected: FAIL — cannot find `../src/core/normalize.js`.

- [ ] **Step 3: Write minimal implementation** — `src/core/normalize.js`

```js
export function normalizeTweet(raw) {
  const id = raw?.rest_id ?? raw?.legacy?.id_str ?? null;
  if (!id) return null;
  const legacy = raw.legacy ?? {};
  const user = raw?.core?.user_results?.result?.legacy ?? {};
  const handle = user.screen_name ?? '';
  const media = (legacy.extended_entities?.media ?? legacy.entities?.media ?? [])
    .map((m) => ({ type: m.type, url: m.media_url_https ?? m.media_url ?? '' }));
  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : null,
    text: legacy.full_text ?? legacy.text ?? '',
    author: user.name ?? '',
    handle: handle ? `@${handle}` : '',
    avatar: user.profile_image_url_https ?? '',
    createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    media,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/normalize.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/normalize.js tests/normalize.test.js
git commit -m "feat(core): normalizeTweet raw GraphQL -> Bookmark"
```

## Task 4: Core — assignSaveRank

**Files:**
- Create: `src/core/ranking.js`, `tests/ranking.test.js`

**Interfaces:**
- Consumes: array of `Bookmark` in X's newest-saved-first order.
- Produces: `assignSaveRank(newestFirst) -> Bookmark[]` where each has `saveRank` (`#1 = oldest`, `#N = newest`). Consumed by Task 12 sync.

- [ ] **Step 1: Write the failing test** — `tests/ranking.test.js`

```js
import { describe, it, expect } from 'vitest';
import { assignSaveRank } from '../src/core/ranking.js';

describe('assignSaveRank', () => {
  it('ranks oldest-saved as #1 and newest as #N', () => {
    const newestFirst = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; // a=newest, c=oldest
    expect(assignSaveRank(newestFirst)).toEqual([
      { id: 'a', saveRank: 3 },
      { id: 'b', saveRank: 2 },
      { id: 'c', saveRank: 1 },
    ]);
  });
  it('handles empty input', () => {
    expect(assignSaveRank([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ranking.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `src/core/ranking.js`

```js
export function assignSaveRank(newestFirst) {
  const n = newestFirst.length;
  return newestFirst.map((b, i) => ({ ...b, saveRank: n - i }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ranking.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/ranking.js tests/ranking.test.js
git commit -m "feat(core): assignSaveRank (oldest=#1)"
```

## Task 5: Core — mergeBookmarks

**Files:**
- Create: `src/core/merge.js`, `tests/merge.test.js`

**Interfaces:**
- Consumes: `existing` (map id→Bookmark), `incoming` (Bookmark[] ranked).
- Produces: `mergeBookmarks(existing, incoming, now?) -> map id→Bookmark`. Incoming is server truth: updates fields, adds new, drops ids absent from incoming, stamps `fetchedAt`. Consumed by Task 12.

- [ ] **Step 1: Write the failing test** — `tests/merge.test.js`

```js
import { describe, it, expect } from 'vitest';
import { mergeBookmarks } from '../src/core/merge.js';

describe('mergeBookmarks', () => {
  const now = '2026-07-10T00:00:00.000Z';
  it('adds new, updates existing, drops server-removed, stamps fetchedAt', () => {
    const existing = { x: { id: 'x', text: 'old' }, y: { id: 'y', text: 'gone' } };
    const incoming = [{ id: 'x', text: 'new' }, { id: 'z', text: 'fresh' }];
    const merged = mergeBookmarks(existing, incoming, now);
    expect(Object.keys(merged).sort()).toEqual(['x', 'z']);
    expect(merged.x).toEqual({ id: 'x', text: 'new', fetchedAt: now });
    expect(merged.z).toEqual({ id: 'z', text: 'fresh', fetchedAt: now });
  });
  it('last duplicate id wins', () => {
    const merged = mergeBookmarks({}, [{ id: 'a', text: '1' }, { id: 'a', text: '2' }], now);
    expect(merged.a.text).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/merge.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `src/core/merge.js`

```js
export function mergeBookmarks(existing, incoming, now = new Date().toISOString()) {
  const merged = {};
  for (const b of incoming) {
    merged[b.id] = { ...(existing[b.id] ?? {}), ...b, fetchedAt: now };
  }
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/merge.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/merge.js tests/merge.test.js
git commit -m "feat(core): mergeBookmarks (server truth + fetchedAt)"
```

## Task 6: Core — countLeft

**Files:**
- Create: `src/core/count.js`, `tests/count.test.js`

**Interfaces:**
- Produces: `countLeft(bookmarks, cleared) -> number` = ids where `cleared[id]?.action !== 'done'` (keep still counts). Consumed by card + popup.

- [ ] **Step 1: Write the failing test** — `tests/count.test.js`

```js
import { describe, it, expect } from 'vitest';
import { countLeft } from '../src/core/count.js';

describe('countLeft', () => {
  const bookmarks = { a: {}, b: {}, c: {} };
  it('subtracts only done items; keep still counts', () => {
    const cleared = { a: { action: 'done' }, b: { action: 'keep' } };
    expect(countLeft(bookmarks, cleared)).toBe(2); // b (keep) + c
  });
  it('returns total when nothing cleared', () => {
    expect(countLeft(bookmarks, {})).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/count.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `src/core/count.js`

```js
export function countLeft(bookmarks, cleared) {
  return Object.keys(bookmarks).filter((id) => cleared[id]?.action !== 'done').length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/count.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/count.js tests/count.test.js
git commit -m "feat(core): countLeft (done decrements, keep does not)"
```

## Task 7: Core — pickBookmark (random + filters)

**Files:**
- Create: `src/core/selection.js`, `tests/selection.test.js`

**Interfaces:**
- Produces: `pickBookmark(bookmarks, cleared, opts) -> Bookmark | null`.
  `opts = { now?, cooldownHours=72, rng=Math.random }`. Excludes `done`; excludes
  `keep` within cooldown; if that empties the pool, falls back to all non-done;
  returns `null` if none. Consumed by Task 10.

- [ ] **Step 1: Write the failing test** — `tests/selection.test.js`

```js
import { describe, it, expect } from 'vitest';
import { pickBookmark } from '../src/core/selection.js';

const bm = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' } };
const first = () => 0; // rng stub → picks pool[0]

describe('pickBookmark', () => {
  it('never returns a done item', () => {
    const cleared = { a: { action: 'done' } };
    const got = pickBookmark(bm, cleared, { rng: first });
    expect(got.id).not.toBe('a');
  });
  it('excludes keep within cooldown', () => {
    const now = '2026-07-10T12:00:00Z';
    const cleared = {
      a: { action: 'keep', at: '2026-07-10T11:00:00Z' }, // 1h ago < 72h
      b: { action: 'keep', at: '2026-07-10T11:00:00Z' },
    };
    expect(pickBookmark(bm, cleared, { now, cooldownHours: 72, rng: first }).id).toBe('c');
  });
  it('includes keep after cooldown expires', () => {
    const now = '2026-07-20T12:00:00Z';
    const cleared = { a: { action: 'keep', at: '2026-07-10T11:00:00Z' } }; // >72h
    expect(pickBookmark(bm, cleared, { now, cooldownHours: 72, rng: first }).id).toBe('a');
  });
  it('falls back to non-done when all are cooled down', () => {
    const now = '2026-07-10T12:00:00Z';
    const cleared = {
      a: { action: 'keep', at: now }, b: { action: 'keep', at: now }, c: { action: 'keep', at: now },
    };
    expect(pickBookmark(bm, cleared, { now, rng: first }).id).toBe('a');
  });
  it('returns null when all done', () => {
    const cleared = { a: { action: 'done' }, b: { action: 'done' }, c: { action: 'done' } };
    expect(pickBookmark(bm, cleared, { rng: first })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/selection.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `src/core/selection.js`

```js
export function pickBookmark(bookmarks, cleared, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const cooldownMs = (opts.cooldownHours ?? 72) * 3600e3;
  const rng = opts.rng ?? Math.random;
  const notDone = Object.values(bookmarks).filter((b) => cleared[b.id]?.action !== 'done');
  const active = notDone.filter((b) => {
    const c = cleared[b.id];
    if (c?.action === 'keep') return now - new Date(c.at).getTime() >= cooldownMs;
    return true;
  });
  const pool = active.length ? active : notDone;
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/selection.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/selection.js tests/selection.test.js
git commit -m "feat(core): pickBookmark random with done/keep-cooldown filters"
```

## Task 8: x-api — GraphQL builders + parser

**Files:**
- Create: `src/x-api/constants.js`, `src/x-api/graphql.js`, `tests/graphql.test.js`, `fixtures/bookmarks-response.json`

**Interfaces:**
- Produces: `buildBookmarksRequest(auth, cursor?)`, `buildMutationRequest(operation, auth, tweetId)`, and `parseBookmarks(payload)`.
- `auth = { bearer, csrf, queryIds, operationHeaders, operationTemplates }`; templates preserve X's captured feature flags/body shape while dynamic cursor/tweet IDs are replaced. Bearer/CSRF values are session-memory only. Task 11 supplies auth; Task 12 consumes these functions.

- [ ] **Step 1: Write the trimmed response fixture** — `fixtures/bookmarks-response.json`

```json
{
  "data": {
    "bookmark_timeline_v2": {
      "timeline": {
        "instructions": [{
          "type": "TimelineAddEntries",
          "entries": [
            {
              "entryId": "tweet-1806",
              "content": {
                "itemContent": {
                  "tweet_results": {
                    "result": {
                      "rest_id": "1806",
                      "legacy": { "full_text": "I hoard X bookmarks", "created_at": "Sat Jun 21 13:37:00 +0000 2026" },
                      "core": { "user_results": { "result": { "legacy": { "name": "Zara Zhang", "screen_name": "zarazhangrui", "profile_image_url_https": "https://pbs.twimg.com/av.jpg" } } } }
                    }
                  }
                }
              }
            },
            {
              "entryId": "cursor-bottom-0",
              "content": { "cursorType": "Bottom", "value": "NEXT_CURSOR" }
            }
          ]
        }]
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests** — `tests/graphql.test.js`

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBookmarksRequest, buildMutationRequest, parseBookmarks } from '../src/x-api/graphql.js';

const fixture = JSON.parse(readFileSync('fixtures/bookmarks-response.json', 'utf8'));
const auth = {
  bearer: 'Bearer captured',
  csrf: 'csrf-token',
  queryIds: { Bookmarks: 'read123', DeleteBookmark: 'del123', CreateBookmark: 'create123' },
  operationHeaders: { Bookmarks: { 'x-client-transaction-id': 'captured-tx' } },
  operationTemplates: {
    Bookmarks: { params: { features: '{"captured":true}' } },
    DeleteBookmark: { body: { features: { captured: true }, variables: { dark_request: false } } },
  },
};

describe('X GraphQL requests', () => {
  it('builds an authenticated Bookmarks GET with optional cursor', () => {
    const { url, init } = buildBookmarksRequest(auth, 'CURSOR');
    expect(url).toContain('/i/api/graphql/read123/Bookmarks?');
    expect(JSON.parse(new URL(url).searchParams.get('variables'))).toMatchObject({ count: 100, cursor: 'CURSOR' });
    expect(new URL(url).searchParams.get('features')).toBe('{"captured":true}');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(init.headers).toMatchObject({
      authorization: 'Bearer captured',
      'x-csrf-token': 'csrf-token',
      'x-client-transaction-id': 'captured-tx',
    });
  });

  it('builds DeleteBookmark POST', () => {
    const { url, init } = buildMutationRequest('DeleteBookmark', auth, '1806');
    expect(url).toBe('https://x.com/i/api/graphql/del123/DeleteBookmark');
    expect(JSON.parse(init.body)).toEqual({
      features: { captured: true },
      variables: { dark_request: false, tweet_id: '1806' },
      queryId: 'del123',
    });
  });

  it('parses tweet results and bottom cursor', () => {
    const parsed = parseBookmarks(fixture);
    expect(parsed.tweets).toHaveLength(1);
    expect(parsed.tweets[0].rest_id).toBe('1806');
    expect(parsed.nextCursor).toBe('NEXT_CURSOR');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run tests/graphql.test.js`
Expected: FAIL — cannot find `src/x-api/graphql.js`.

- [ ] **Step 4: Create constants** — `src/x-api/constants.js`

```js
export const X_ORIGIN = 'https://x.com';
export const OPERATIONS = Object.freeze({
  BOOKMARKS: 'Bookmarks',
  DELETE: 'DeleteBookmark',
  CREATE: 'CreateBookmark',
});

// Captured live values always win. No account token or cookie is committed here.
export const BOOKMARK_FEATURES = Object.freeze({
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
});
```

- [ ] **Step 5: Implement builders + parser** — `src/x-api/graphql.js`

```js
import { BOOKMARK_FEATURES, OPERATIONS, X_ORIGIN } from './constants.js';

function headersFor(operation, auth) {
  return {
    accept: '*/*',
    authorization: auth.bearer,
    'content-type': 'application/json',
    'x-csrf-token': auth.csrf,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    ...(auth.operationHeaders?.[operation] ?? {}),
  };
}

export function buildBookmarksRequest(auth, cursor = null) {
  const operation = OPERATIONS.BOOKMARKS;
  const queryId = auth.queryIds?.[operation];
  if (!queryId || !auth.bearer || !auth.csrf) throw new Error('X auth capture incomplete');
  const templateParams = auth.operationTemplates?.[operation]?.params ?? {};
  const variables = { ...JSON.parse(templateParams.variables ?? '{}'), count: 100, includePromotedContent: false };
  if (cursor) variables.cursor = cursor;
  else delete variables.cursor;
  const params = new URLSearchParams(templateParams);
  params.set('variables', JSON.stringify(variables));
  if (!params.has('features')) params.set('features', JSON.stringify(BOOKMARK_FEATURES));
  return {
    url: `${X_ORIGIN}/i/api/graphql/${queryId}/${operation}?${params}`,
    init: { method: 'GET', credentials: 'include', headers: headersFor(operation, auth) },
  };
}

export function buildMutationRequest(operation, auth, tweetId) {
  if (![OPERATIONS.DELETE, OPERATIONS.CREATE].includes(operation)) throw new Error(`Unsupported mutation: ${operation}`);
  const queryId = auth.queryIds?.[operation];
  if (!queryId || !auth.bearer || !auth.csrf) throw new Error('X auth capture incomplete');
  const templateBody = auth.operationTemplates?.[operation]?.body ?? {};
  const body = {
    ...templateBody,
    variables: { ...(templateBody.variables ?? {}), tweet_id: tweetId },
    queryId,
  };
  return {
    url: `${X_ORIGIN}/i/api/graphql/${queryId}/${operation}`,
    init: {
      method: 'POST', credentials: 'include', headers: headersFor(operation, auth),
      body: JSON.stringify(body),
    },
  };
}

function resultFromEntry(entry) {
  const direct = entry?.content?.itemContent?.tweet_results?.result;
  if (direct) return [direct.tweet ?? direct];
  return (entry?.content?.items ?? []).map((item) => {
    const result = item?.item?.itemContent?.tweet_results?.result;
    return result?.tweet ?? result;
  }).filter(Boolean);
}

export function parseBookmarks(payload) {
  const instructions = payload?.data?.bookmark_timeline_v2?.timeline?.instructions
    ?? payload?.data?.bookmark_timeline?.timeline?.instructions
    ?? [];
  const entries = instructions.flatMap((instruction) => instruction.entries ?? []);
  const tweets = entries.flatMap(resultFromEntry);
  const nextCursor = entries.find((entry) => entry?.content?.cursorType === 'Bottom')?.content?.value ?? null;
  return { tweets, nextCursor };
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/graphql.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/x-api tests/graphql.test.js fixtures/bookmarks-response.json
git commit -m "feat(x-api): build and parse bookmark GraphQL requests"
```

## Task 9: storage wrapper + defaults

**Files:**
- Create: `src/storage.js`, `tests/storage.test.js`
- Modify: `docs/superpowers/plans/2026-07-10-x-bookmark-injector.md` file map (add `storage.test.js` during self-review)

**Interfaces:**
- Produces: `DEFAULT_STATE`, pure `applyDefaults(raw)`, `loadState()`, and `savePatch(patch)`.
- State shape: `{bookmarks, cleared, meta, auth, settings}` from the approved spec. Bearer and CSRF are intentionally absent; only `queryIds` persist.

- [ ] **Step 1: Write failing tests** — `tests/storage.test.js`

```js
import { describe, expect, it } from 'vitest';
import { applyDefaults } from '../src/storage.js';

describe('applyDefaults', () => {
  it('supplies a complete initial state', () => {
    expect(applyDefaults({})).toEqual({
      bookmarks: {}, cleared: {},
      meta: { total: 0, lastSync: null, syncStatus: 'idle', syncError: null },
      auth: { queryIds: {} },
      settings: { confirmRealDelete: true, deleteConfirmed: false, keepCooldownHours: 72, syncEveryHours: 24, cardStyle: 'hybrid' },
    });
  });

  it('deep-merges nested settings without deleting defaults', () => {
    const state = applyDefaults({ settings: { keepCooldownHours: 24 }, meta: { total: 4 } });
    expect(state.settings.keepCooldownHours).toBe(24);
    expect(state.settings.syncEveryHours).toBe(24);
    expect(state.meta).toMatchObject({ total: 4, syncStatus: 'idle' });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/storage.test.js`
Expected: FAIL — cannot find `src/storage.js`.

- [ ] **Step 3: Implement storage wrapper** — `src/storage.js`

```js
export const DEFAULT_STATE = Object.freeze({
  bookmarks: {},
  cleared: {},
  meta: { total: 0, lastSync: null, syncStatus: 'idle', syncError: null },
  auth: { queryIds: {} },
  settings: {
    confirmRealDelete: true,
    deleteConfirmed: false,
    keepCooldownHours: 72,
    syncEveryHours: 24,
    cardStyle: 'hybrid',
  },
});

export function applyDefaults(raw = {}) {
  return {
    bookmarks: { ...DEFAULT_STATE.bookmarks, ...(raw.bookmarks ?? {}) },
    cleared: { ...DEFAULT_STATE.cleared, ...(raw.cleared ?? {}) },
    meta: { ...DEFAULT_STATE.meta, ...(raw.meta ?? {}) },
    auth: { ...DEFAULT_STATE.auth, ...(raw.auth ?? {}), queryIds: { ...(raw.auth?.queryIds ?? {}) } },
    settings: { ...DEFAULT_STATE.settings, ...(raw.settings ?? {}) },
  };
}

export async function loadState() {
  return applyDefaults(await chrome.storage.local.get(null));
}

export async function savePatch(patch) {
  await chrome.storage.local.set(patch);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/storage.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage.js tests/storage.test.js
git commit -m "feat: define local extension state and storage helpers"
```

## Task 10: Real card rendering (ui/card.js) + wire into content

**Files:**
- Create: `src/ui/card.js`, `tests/card.test.js`
- Modify: `src/content.js`

**Interfaces:**
- Consumes: `Bookmark`, `{total,left}`, and handlers `{onKeep,onDone}`.
- Produces: pure `formatCardMeta(bookmark,total,left)` and DOM `buildCardElement(...)`; `content.js` selects once per Home visit and pins the card at the top.

- [ ] **Step 1: Write failing metadata tests** — `tests/card.test.js`

```js
import { describe, expect, it } from 'vitest';
import { formatCardMeta } from '../src/ui/card.js';

describe('formatCardMeta', () => {
  it('labels save order, posted date, and remaining count honestly', () => {
    expect(formatCardMeta({ saveRank: 12, createdAt: '2026-06-21T13:37:00Z' }, 87, 74)).toEqual({
      rank: 'Saved #12 of 87 · 12th oldest',
      posted: 'Posted Jun 21, 2026',
      left: '74 left',
    });
  });
  it('uses correct ordinal suffixes', () => {
    expect(formatCardMeta({ saveRank: 1 }, 20, 20).rank).toContain('1st oldest');
    expect(formatCardMeta({ saveRank: 2 }, 20, 20).rank).toContain('2nd oldest');
    expect(formatCardMeta({ saveRank: 3 }, 20, 20).rank).toContain('3rd oldest');
    expect(formatCardMeta({ saveRank: 11 }, 20, 20).rank).toContain('11th oldest');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/card.test.js`
Expected: FAIL — cannot find `src/ui/card.js`.

- [ ] **Step 3: Implement card formatter and safe DOM builder** — `src/ui/card.js`

```js
import { CARD_ID } from '../selectors.js';

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
}

export function formatCardMeta(bookmark, total, left) {
  return {
    rank: `Saved #${bookmark.saveRank} of ${total} · ${ordinal(bookmark.saveRank)} oldest`,
    posted: bookmark.createdAt
      ? `Posted ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(bookmark.createdAt))}`
      : 'Posted time unavailable',
    left: `${left} left`,
  };
}

function node(tag, text, css = '') {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text; // Never inject tweet text as HTML.
  if (css) el.style.cssText = css;
  return el;
}

function chip(text, accent = false) {
  return node('span', text, `font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid ${accent ? '#1d9bf0' : 'color-mix(in srgb,currentColor 18%,transparent)'};color:${accent ? '#1d9bf0' : 'inherit'}`);
}

function action(label, primary, handler) {
  const button = node('button', label, `flex:1;padding:8px 12px;border-radius:999px;font-weight:700;cursor:pointer;border:1px solid ${primary ? '#1d9bf0' : 'color-mix(in srgb,currentColor 22%,transparent)'};background:${primary ? '#1d9bf0' : 'transparent'};color:${primary ? '#fff' : 'inherit'}`);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

export function buildCardElement(bookmark, stats, handlers) {
  const meta = formatCardMeta(bookmark, stats.total, stats.left);
  const card = node('article', null, 'padding:12px 16px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);border-left:3px solid #1d9bf0;color:inherit;background:color-mix(in srgb,#1d9bf0 5%,transparent);font:15px/1.4 system-ui');
  card.id = CARD_ID;
  card.dataset.testid = 'cellInnerDiv';

  const header = node('div', null, 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px');
  header.append(node('strong', '📌 From your bookmarks', 'color:#1d9bf0;font-size:12.5px'), chip(meta.left, true));
  card.append(header);

  const chips = node('div', null, 'display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px');
  chips.append(chip(meta.rank, true), chip(meta.posted));
  card.append(chips);

  const authorRow = node('div', null, 'display:flex;align-items:center;gap:9px;margin-bottom:6px');
  if (bookmark.avatar) {
    const avatar = document.createElement('img');
    avatar.src = bookmark.avatar; avatar.alt = ''; avatar.width = 40; avatar.height = 40;
    avatar.style.cssText = 'border-radius:50%;object-fit:cover';
    authorRow.append(avatar);
  }
  const identity = node('div');
  identity.append(node('strong', bookmark.author || bookmark.handle || 'Unknown author'));
  if (bookmark.handle) identity.append(node('span', ` ${bookmark.handle}`, 'opacity:.62'));
  authorRow.append(identity);
  card.append(authorRow, node('div', bookmark.text, 'white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:9px'));

  const firstMedia = bookmark.media?.[0];
  if (firstMedia?.url) {
    const image = document.createElement('img');
    image.src = firstMedia.url; image.alt = ''; image.loading = 'lazy';
    image.style.cssText = 'width:100%;max-height:360px;object-fit:cover;border-radius:14px;margin:4px 0 10px';
    card.append(image);
  }

  const buttons = node('div', null, 'display:flex;gap:10px;margin-top:10px');
  buttons.append(action('Keep for later', false, handlers.onKeep), action('Done ✓ Remove from X', true, handlers.onDone));
  card.append(buttons);
  card.addEventListener('dblclick', () => window.open(bookmark.url, '_blank', 'noopener'));
  return card;
}
```

- [ ] **Step 4: Run metadata tests**

Run: `npx vitest run tests/card.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace static injection in `src/content.js`**

```js
import { countLeft } from './core/count.js';
import { pickBookmark } from './core/selection.js';
import { loadState } from './storage.js';
import { CARD_ID, SEL, isHome } from './selectors.js';
import { buildCardElement } from './ui/card.js';

let handledThisHomeVisit = false;
let lastPath = location.pathname;

async function pinRandomCard() {
  if (!isHome()) { document.getElementById(CARD_ID)?.remove(); return; }
  if (handledThisHomeVisit || document.getElementById(CARD_ID)) return;
  const firstCell = document.querySelector(SEL.timeline)?.querySelector(SEL.cell);
  if (!firstCell?.parentElement) return;

  const state = await loadState();
  const bookmark = pickBookmark(state.bookmarks, state.cleared, { cooldownHours: state.settings.keepCooldownHours });
  if (!bookmark) return;
  const stats = { total: Object.keys(state.bookmarks).length, left: countLeft(state.bookmarks, state.cleared) };
  const dismiss = () => { document.getElementById(CARD_ID)?.remove(); };
  const runAction = async (action) => {
    const result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action, tweetId: bookmark.id });
    if (result?.ok) dismiss();
  };
  const card = buildCardElement(bookmark, stats, {
    onKeep: () => runAction('keep'),
    onDone: async () => {
      if (state.settings.confirmRealDelete && !state.settings.deleteConfirmed) {
        const approved = window.confirm('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
        if (!approved) return;
      }
      await runAction('done');
    },
  });
  firstCell.parentElement.insertBefore(card, firstCell);
  handledThisHomeVisit = true;
}

new MutationObserver(() => void pinRandomCard()).observe(document.body, { childList: true, subtree: true });
setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    handledThisHomeVisit = false;
    document.getElementById(CARD_ID)?.remove();
    void pinRandomCard();
  }
}, 500);

void pinRandomCard();
```

- [ ] **Step 6: Build + manual seed verification**

Run: `npm run build`
Expected: build succeeds.

Manual seed in the extension service-worker console:
```js
chrome.storage.local.set({
  bookmarks: { '1806': { id:'1806', url:'https://x.com/zarazhangrui/status/1806', text:'I hoard X bookmarks and never read them.', author:'Zara Zhang', handle:'@zarazhangrui', avatar:'', createdAt:'2026-06-21T13:37:00Z', media:[], saveRank:1 } },
  cleared: {}, meta:{ total:1 }, settings:{ keepCooldownHours:72, confirmRealDelete:true, deleteConfirmed:false }
});
```

Reload `x.com/home`. Expected: real-data Hybrid card is first and says `Saved #1 of 1`. The real sync verifies multi-item ranks/counts in Task 12.

- [ ] **Step 7: Commit**

```bash
git add src/ui/card.js src/content.js tests/card.test.js
git commit -m "feat(ui): pin random bookmark card with rank and count"
```

## Task 11: inpage.js auth interceptor + extractAuth helper

**Files:**
- Create: `src/bridge.js`, `tests/bridge.test.js`
- Modify: `src/inpage.js`, `src/content.js`, `src/background.js`

**Interfaces:**
- Produces pure `captureFromRequest(url, headers, {method,body})` and `mergeAuth(current,capture)`; capture includes safe per-operation params/body templates.
- MAIN world posts `XBI_AUTH_CAPTURE` and executes only validated `x.com/i/api/graphql/*` requests.
- ISOLATED content relays `XBI_PAGE_REQUEST` request/response messages to/from MAIN world and forwards auth captures to background.
- Background holds Bearer/CSRF in memory; only `queryIds` persist.

- [ ] **Step 1: Write failing bridge tests** — `tests/bridge.test.js`

```js
import { describe, expect, it } from 'vitest';
import { captureFromRequest, mergeAuth } from '../src/bridge.js';

describe('page bridge auth capture', () => {
  it('extracts operation, queryId, auth, and safe replay headers', () => {
    expect(captureFromRequest(
      'https://x.com/i/api/graphql/read123/Bookmarks?variables=x',
      {
        authorization: 'Bearer web-token',
        'x-csrf-token': 'csrf',
        'x-client-transaction-id': 'tx-1',
        cookie: 'must-not-cross-worlds',
      },
    )).toEqual({
      operation: 'Bookmarks', queryId: 'read123', bearer: 'Bearer web-token', csrf: 'csrf',
      operationHeaders: { 'x-client-transaction-id': 'tx-1' },
      operationTemplate: { method: 'GET', params: { variables: 'x' }, body: null },
    });
  });

  it('ignores non-GraphQL URLs', () => {
    expect(captureFromRequest('https://x.com/home', {})).toBeNull();
  });

  it('merges captures by operation without losing prior ids', () => {
    const current = { bearer: 'old', csrf: 'c1', queryIds: { Bookmarks: 'r1' }, operationHeaders: {}, operationTemplates: {} };
    const capture = { operation: 'DeleteBookmark', queryId: 'd1', bearer: 'new', csrf: 'c2', operationHeaders: { 'x-client-transaction-id': 'tx' }, operationTemplate: { method: 'POST', params: {}, body: { features: { captured: true } } } };
    expect(mergeAuth(current, capture)).toEqual({
      bearer: 'new', csrf: 'c2',
      queryIds: { Bookmarks: 'r1', DeleteBookmark: 'd1' },
      operationHeaders: { DeleteBookmark: { 'x-client-transaction-id': 'tx' } },
      operationTemplates: { DeleteBookmark: { method: 'POST', params: {}, body: { features: { captured: true } } } },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/bridge.test.js`
Expected: FAIL — cannot find `src/bridge.js`.

- [ ] **Step 3: Implement pure bridge helpers** — `src/bridge.js`

```js
export const PAGE_SOURCE = 'xbi-page';
export const EXT_SOURCE = 'xbi-extension';

function plainHeaders(input = {}) {
  if (typeof Headers !== 'undefined' && input instanceof Headers) return Object.fromEntries(input.entries());
  if (Array.isArray(input)) return Object.fromEntries(input.map(([k, v]) => [k.toLowerCase(), v]));
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k.toLowerCase(), v]));
}

export function captureFromRequest(rawUrl, rawHeaders, { method = 'GET', body = null } = {}) {
  const url = new URL(rawUrl, 'https://x.com');
  const match = url.pathname.match(/^\/i\/api\/graphql\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  const headers = plainHeaders(rawHeaders);
  const operationHeaders = {};
  for (const key of ['x-client-transaction-id', 'x-twitter-client-language']) {
    if (headers[key]) operationHeaders[key] = headers[key];
  }
  let parsedBody = null;
  if (typeof body === 'string') {
    try { parsedBody = JSON.parse(body); } catch { parsedBody = null; }
  } else if (body && typeof body === 'object') parsedBody = body;
  return {
    operation: decodeURIComponent(match[2]),
    queryId: match[1],
    bearer: headers.authorization ?? null,
    csrf: headers['x-csrf-token'] ?? null,
    operationHeaders,
    operationTemplate: { method, params: Object.fromEntries(url.searchParams), body: parsedBody },
  };
}

export function mergeAuth(current = {}, capture) {
  return {
    bearer: capture.bearer ?? current.bearer ?? null,
    csrf: capture.csrf ?? current.csrf ?? null,
    queryIds: { ...(current.queryIds ?? {}), [capture.operation]: capture.queryId },
    operationHeaders: {
      ...(current.operationHeaders ?? {}),
      [capture.operation]: capture.operationHeaders ?? {},
    },
    operationTemplates: {
      ...(current.operationTemplates ?? {}),
      [capture.operation]: capture.operationTemplate ?? {},
    },
  };
}
```

- [ ] **Step 4: Run bridge tests**

Run: `npx vitest run tests/bridge.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement MAIN-world capture + constrained executor** — replace `src/inpage.js`

```js
import { captureFromRequest, EXT_SOURCE, PAGE_SOURCE } from './bridge.js';

const realFetch = window.fetch.bind(window);

function mergedHeaders(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function publishCapture(input, init) {
  const url = input instanceof Request ? input.url : String(input);
  const capture = captureFromRequest(url, mergedHeaders(input, init), {
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    body: init?.body ?? null,
  });
  if (capture) window.postMessage({ source: PAGE_SOURCE, type: 'XBI_AUTH_CAPTURE', capture }, '*');
}

window.fetch = function xbiFetch(input, init) {
  publishCapture(input, init);
  return realFetch(input, init);
};

const realOpen = XMLHttpRequest.prototype.open;
const realSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const realSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this.__xbi = { method, url, headers: {} };
  return realOpen.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.setRequestHeader = function(key, value) {
  if (this.__xbi) this.__xbi.headers[key] = value;
  return realSetHeader.call(this, key, value);
};
XMLHttpRequest.prototype.send = function(body) {
  if (this.__xbi) publishCapture(this.__xbi.url, { method: this.__xbi.method, headers: this.__xbi.headers, body });
  return realSend.call(this, body);
};

window.addEventListener('message', async (event) => {
  const message = event.data;
  if (event.source !== window || message?.source !== EXT_SOURCE || message.type !== 'XBI_EXECUTE') return;
  const { requestId, request } = message;
  try {
    const url = new URL(request.url);
    if (url.origin !== 'https://x.com' || !url.pathname.startsWith('/i/api/graphql/')) {
      throw new Error('Blocked non-X GraphQL page request');
    }
    const response = await realFetch(request.url, request.init);
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { text }; }
    window.postMessage({ source: PAGE_SOURCE, type: 'XBI_EXECUTE_RESULT', requestId, ok: response.ok, status: response.status, payload }, '*');
  } catch (error) {
    window.postMessage({ source: PAGE_SOURCE, type: 'XBI_EXECUTE_RESULT', requestId, ok: false, status: 0, error: String(error) }, '*');
  }
});
```

- [ ] **Step 6: Add the ISOLATED-world relay to `src/content.js`**

Add these imports and bridge block above the card logic:

```js
import { EXT_SOURCE, mergeAuth, PAGE_SOURCE } from './bridge.js';

let latestAuth = { bearer: null, csrf: null, queryIds: {}, operationHeaders: {}, operationTemplates: {} };
const pendingPageRequests = new Map();

window.addEventListener('message', (event) => {
  const message = event.data;
  if (event.source !== window || message?.source !== PAGE_SOURCE) return;
  if (message.type === 'XBI_AUTH_CAPTURE') {
    latestAuth = mergeAuth(latestAuth, message.capture);
    void chrome.runtime.sendMessage({ type: 'XBI_AUTH_CAPTURE', capture: message.capture });
  }
  if (message.type === 'XBI_EXECUTE_RESULT') {
    const pending = pendingPageRequests.get(message.requestId);
    if (pending) { pendingPageRequests.delete(message.requestId); pending(message); }
  }
});

function executeInPage(request) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPageRequests.delete(requestId);
      resolve({ ok: false, status: 0, error: 'Page request timed out' });
    }, 20_000);
    pendingPageRequests.set(requestId, (result) => { clearTimeout(timeout); resolve(result); });
    window.postMessage({ source: EXT_SOURCE, type: 'XBI_EXECUTE', requestId, request }, '*');
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'XBI_GET_PAGE_AUTH') { sendResponse(latestAuth); return false; }
  if (message.type === 'XBI_PAGE_REQUEST') {
    executeInPage(message.request).then(sendResponse);
    return true;
  }
  return false;
});
```

- [ ] **Step 7: Store captures in service-worker memory** — replace `src/background.js` temporarily

```js
import { mergeAuth } from './bridge.js';
import { savePatch } from './storage.js';

let sessionAuth = { bearer: null, csrf: null, queryIds: {}, operationHeaders: {}, operationTemplates: {} };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'XBI_AUTH_CAPTURE') {
    sessionAuth = mergeAuth(sessionAuth, message.capture);
    savePatch({ auth: { queryIds: sessionAuth.queryIds } }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'XBI_GET_SESSION_AUTH') { sendResponse(sessionAuth); return false; }
  return false;
});
```

- [ ] **Step 8: Build + execute the feasibility gate**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds.

Manual initialization (personal extension, once per operation rotation):
1. Reload the unpacked extension and open `x.com/i/bookmarks` → captures `Bookmarks`.
2. On a disposable tweet, bookmark then unbookmark once → captures `CreateBookmark` + `DeleteBookmark` without risking backlog data.
3. In the extension service-worker console run `chrome.runtime.sendMessage({type:'XBI_GET_SESSION_AUTH'}).then(console.log)`.
4. Expected: non-null Bearer/CSRF and all three operation IDs. `chrome.storage.local.get('auth')` contains query IDs only, never Bearer/CSRF.
5. Send one `buildBookmarksRequest(...)` through `XBI_PAGE_REQUEST`; expected HTTP 200 + JSON timeline. This **must pass before Task 12**.

- [ ] **Step 9: Commit**

```bash
git add src/bridge.js src/inpage.js src/content.js src/background.js tests/bridge.test.js
git commit -m "feat: capture X session auth and execute GraphQL in page context"
```

## Task 12: background sync + Done/Keep/Undo actions

**Files:**
- Create: `src/sync.js`, `tests/sync.test.js`
- Modify: `src/background.js`, `src/content.js`

**Interfaces:**
- Produces: `collectBookmarkPages(fetchPage,{maxPages}) -> rawTweet[]` and background messages:
  - `XBI_SYNC` → `{ok,total}`
  - `XBI_ACTION keep|done|undo` → `{ok,undoUntil?}`
  - `XBI_GET_STATE` → public local state (no session tokens)
- Cache publication is transactional: only replace `bookmarks` after every page succeeds.

- [ ] **Step 1: Write failing pagination tests** — `tests/sync.test.js`

```js
import { describe, expect, it, vi } from 'vitest';
import { collectBookmarkPages } from '../src/sync.js';

describe('collectBookmarkPages', () => {
  it('follows cursors and preserves newest-first order', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'new' }], nextCursor: 'C2' })
      .mockResolvedValueOnce({ tweets: [{ rest_id: 'old' }], nextCursor: null });
    expect(await collectBookmarkPages(fetchPage)).toEqual([{ rest_id: 'new' }, { rest_id: 'old' }]);
    expect(fetchPage.mock.calls).toEqual([[null], ['C2']]);
  });

  it('stops a repeated-cursor loop', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ tweets: [{ rest_id: 'a' }], nextCursor: 'SAME' });
    await expect(collectBookmarkPages(fetchPage)).rejects.toThrow('cursor repeated');
  });

  it('enforces a hard page cap', async () => {
    const fetchPage = vi.fn(async (cursor) => ({ tweets: [], nextCursor: `${cursor ?? ''}x` }));
    await expect(collectBookmarkPages(fetchPage, { maxPages: 2 })).rejects.toThrow('page limit');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/sync.test.js`
Expected: FAIL — cannot find `src/sync.js`.

- [ ] **Step 3: Implement bounded pagination** — `src/sync.js`

```js
export async function collectBookmarkPages(fetchPage, { maxPages = 100 } = {}) {
  const tweets = [];
  const seenCursors = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(cursor);
    tweets.push(...result.tweets);
    if (!result.nextCursor) return tweets;
    if (seenCursors.has(result.nextCursor)) throw new Error('Bookmark pagination cursor repeated');
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error('Bookmark pagination page limit reached');
}
```

- [ ] **Step 4: Run pagination tests**

Run: `npx vitest run tests/sync.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Replace `src/background.js` with transactional sync + actions**

```js
import { mergeAuth } from './bridge.js';
import { countLeft } from './core/count.js';
import { mergeBookmarks } from './core/merge.js';
import { normalizeTweet } from './core/normalize.js';
import { assignSaveRank } from './core/ranking.js';
import { loadState, savePatch } from './storage.js';
import { collectBookmarkPages } from './sync.js';
import { OPERATIONS } from './x-api/constants.js';
import { buildBookmarksRequest, buildMutationRequest, parseBookmarks } from './x-api/graphql.js';

let sessionAuth = { bearer: null, csrf: null, queryIds: {}, operationHeaders: {}, operationTemplates: {} };
let syncInFlight = null;
const pendingUndo = new Map();

async function xTab(sender) {
  if (sender.tab?.id) return sender.tab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true, url: ['https://x.com/*', 'https://twitter.com/*'] });
  if (!tab?.id) throw new Error('Open x.com in the active tab');
  return tab;
}

async function authFor(tabId) {
  const [state, pageAuth] = await Promise.all([
    loadState(),
    chrome.tabs.sendMessage(tabId, { type: 'XBI_GET_PAGE_AUTH' }),
  ]);
  sessionAuth = {
    bearer: pageAuth?.bearer ?? sessionAuth.bearer,
    csrf: pageAuth?.csrf ?? sessionAuth.csrf,
    queryIds: { ...state.auth.queryIds, ...sessionAuth.queryIds, ...(pageAuth?.queryIds ?? {}) },
    operationHeaders: { ...sessionAuth.operationHeaders, ...(pageAuth?.operationHeaders ?? {}) },
    operationTemplates: { ...sessionAuth.operationTemplates, ...(pageAuth?.operationTemplates ?? {}) },
  };
  if (!sessionAuth.bearer || !sessionAuth.csrf) throw new Error('X session auth not captured; reload x.com');
  return sessionAuth;
}

async function pageRequest(tabId, request) {
  const response = await chrome.tabs.sendMessage(tabId, { type: 'XBI_PAGE_REQUEST', request });
  if (!response?.ok) {
    const error = new Error(response?.error ?? `X request failed (${response?.status ?? 0})`);
    error.status = response?.status ?? 0;
    throw error;
  }
  return response.payload;
}

async function syncBookmarks(tabId) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const prior = await loadState();
    await savePatch({ meta: { ...prior.meta, syncStatus: 'syncing', syncError: null } });
    try {
      const auth = await authFor(tabId);
      const raw = await collectBookmarkPages(async (cursor) => {
        const payload = await pageRequest(tabId, buildBookmarksRequest(auth, cursor));
        return parseBookmarks(payload);
      });
      const ranked = assignSaveRank(raw.map(normalizeTweet).filter(Boolean));
      const bookmarks = mergeBookmarks(prior.bookmarks, ranked);
      const meta = { total: ranked.length, lastSync: new Date().toISOString(), syncStatus: 'idle', syncError: null };
      await savePatch({ bookmarks, meta }); // publish only after complete pagination
      return { ok: true, total: ranked.length, left: countLeft(bookmarks, prior.cleared) };
    } catch (error) {
      const latest = await loadState();
      await savePatch({ meta: { ...latest.meta, syncStatus: 'error', syncError: error.status === 429 ? 'Rate limited by X; try later' : String(error.message ?? error) } });
      return { ok: false, error: String(error.message ?? error), status: error.status ?? 0 };
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

async function act(message, sender) {
  const state = await loadState();
  const at = new Date().toISOString();
  if (message.action === 'keep') {
    await savePatch({ cleared: { ...state.cleared, [message.tweetId]: { action: 'keep', at } } });
    return { ok: true };
  }
  const tab = await xTab(sender);
  const auth = await authFor(tab.id);
  if (message.action === 'done') {
    await pageRequest(tab.id, buildMutationRequest(OPERATIONS.DELETE, auth, message.tweetId));
    const undoUntil = Date.now() + 6_000;
    pendingUndo.set(message.tweetId, undoUntil);
    setTimeout(() => pendingUndo.delete(message.tweetId), 6_100);
    await savePatch({
      cleared: { ...state.cleared, [message.tweetId]: { action: 'done', at } },
      settings: { ...state.settings, deleteConfirmed: true },
    });
    return { ok: true, undoUntil };
  }
  if (message.action === 'undo') {
    if ((pendingUndo.get(message.tweetId) ?? 0) < Date.now()) return { ok: false, error: 'Undo window expired' };
    await pageRequest(tab.id, buildMutationRequest(OPERATIONS.CREATE, auth, message.tweetId));
    const cleared = { ...state.cleared };
    delete cleared[message.tweetId];
    pendingUndo.delete(message.tweetId);
    await savePatch({ cleared });
    return { ok: true };
  }
  return { ok: false, error: `Unknown action: ${message.action}` };
}

async function handleMessage(message, sender) {
  if (message.type === 'XBI_AUTH_CAPTURE') {
    sessionAuth = mergeAuth(sessionAuth, message.capture);
    await savePatch({ auth: { queryIds: sessionAuth.queryIds } });
    return { ok: true };
  }
  if (message.type === 'XBI_SYNC') return syncBookmarks((await xTab(sender)).id);
  if (message.type === 'XBI_ACTION') return act(message, sender);
  if (message.type === 'XBI_GET_STATE') return loadState();
  if (message.type === 'XBI_GET_SESSION_AUTH') return sessionAuth;
  return { ok: false, error: 'Unknown message' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('XBI_')) return false;
  handleMessage(message, sender).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
  return true; // Chrome 114-safe async response path.
});
```

- [ ] **Step 6: Add Undo toast + automatic stale sync to `src/content.js`**

Add this helper above `pinRandomCard`:

```js
function showUndoToast(tweetId, undoUntil) {
  const toast = document.createElement('div');
  toast.id = 'xbi-undo';
  toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#1d9bf0;color:white;padding:10px 14px;border-radius:999px;font:700 14px system-ui;box-shadow:0 8px 30px #0008';
  toast.append('Bookmark removed from X · ');
  const undo = document.createElement('button');
  undo.textContent = 'Undo';
  undo.style.cssText = 'border:0;background:transparent;color:white;text-decoration:underline;font:inherit;cursor:pointer';
  undo.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action: 'undo', tweetId });
    toast.textContent = result?.ok ? 'Bookmark restored' : (result?.error ?? 'Undo failed');
    setTimeout(() => toast.remove(), 1_200);
  });
  toast.append(undo);
  document.body.append(toast);
  setTimeout(() => toast.remove(), Math.max(0, undoUntil - Date.now()));
}

async function maybeSync() {
  if (!isHome()) return;
  const state = await loadState();
  const age = state.meta.lastSync ? Date.now() - new Date(state.meta.lastSync).getTime() : Infinity;
  if (age >= state.settings.syncEveryHours * 3600e3 && state.meta.syncStatus !== 'syncing') {
    await chrome.runtime.sendMessage({ type: 'XBI_SYNC' });
  }
}
```

Inside `pinRandomCard`, replace `runAction` with:

```js
  const runAction = async (action) => {
    const result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action, tweetId: bookmark.id });
    if (!result?.ok) { window.alert(result?.error ?? 'Bookmark action failed'); return; }
    dismiss();
    if (action === 'done' && result.undoUntil) showUndoToast(bookmark.id, result.undoUntil);
  };
```

Append after the existing observer/timer setup:

```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bookmarks && !handledThisHomeVisit) void pinRandomCard();
});
void maybeSync();
```

- [ ] **Step 7: Run all automated verification**

Run: `npm test && npm run build`
Expected: all tests PASS; build succeeds.

- [ ] **Step 8: Manual sync/action verification on the real account**

1. Complete Task 11's capture initialization.
2. Press Sync (temporarily use service-worker console: `chrome.runtime.sendMessage({type:'XBI_SYNC'}).then(console.log)`).
3. Verify popup/storage count equals X Bookmarks and ranks are `1..N` with #1 oldest.
4. Reload Home twice: one random top card each load; both include honest rank, posted date, and count-left.
5. Press Keep: card disappears, X bookmark remains, count-left unchanged.
6. Press Done: one-time confirmation appears; on approve, bookmark disappears from X and count-left falls by one.
7. Press Undo within 6s: bookmark reappears in X and local Done marker clears.
8. Force an invalid `Bookmarks` query ID and sync: old `bookmarks` cache remains unchanged; `meta.syncStatus=error`.
9. Trigger/observe a 429 if feasible only through a mocked page result; never hammer X. Expected user-facing rate-limit error and old cache retained.

- [ ] **Step 9: Commit**

```bash
git add src/sync.js src/background.js src/content.js tests/sync.test.js
git commit -m "feat: sync bookmark backlog and support keep/done/undo"
```

## Task 13: popup dashboard

**Files:**
- Modify: `public/popup.html`, `src/popup.js`

**Interfaces:**
- Consumes background messages `XBI_GET_STATE`, `XBI_SYNC`, `XBI_ACTION`.
- Produces a 360px dashboard: count left, total, last sync/error, Sync now, real-delete confirmation toggle, chronological list with Done/Keep.

- [ ] **Step 1: Replace `public/popup.html`**

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
<title>X Bookmark Injector</title>
<style>
  :root{color-scheme:dark;--bg:#000;--panel:#16181c;--line:#2f3336;--text:#e7e9ea;--muted:#71767b;--blue:#1d9bf0;--red:#f4212e}
  *{box-sizing:border-box} body{width:360px;max-height:600px;margin:0;background:var(--bg);color:var(--text);font:14px/1.4 system-ui}
  header,.controls,.settings{padding:14px 16px;border-bottom:1px solid var(--line)} h1{font-size:17px;margin:0 0 2px}.muted{color:var(--muted)}
  .count{font-size:34px;font-weight:800;letter-spacing:-1px}.count small{font-size:13px;color:var(--muted);font-weight:500;letter-spacing:0}
  button{border:1px solid var(--line);background:transparent;color:inherit;border-radius:999px;padding:7px 12px;font-weight:700;cursor:pointer}
  button.primary{background:var(--blue);border-color:var(--blue);color:white} button:disabled{opacity:.5;cursor:wait}
  .row{display:flex;align-items:center;justify-content:space-between;gap:10px}.error{color:#ff7a7a;margin-top:6px}
  #list{max-height:330px;overflow:auto}.item{padding:11px 16px;border-bottom:1px solid var(--line)}.item-head{display:flex;justify-content:space-between;gap:8px}.snippet{margin:4px 0 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.actions{display:flex;gap:7px}.actions button{font-size:12px;padding:5px 9px}.rank{color:var(--blue);font-size:12px}
</style></head>
<body>
  <header><h1>📌 Bookmark Injector</h1><div class="muted">Turn the backlog into your feed.</div></header>
  <section class="controls">
    <div class="row"><div><div class="count"><span id="left">—</span> <small>left of <span id="total">—</span></small></div><div id="lastSync" class="muted">Never synced</div></div><button id="sync" class="primary">Sync now</button></div>
    <div id="error" class="error" hidden></div>
  </section>
  <section class="settings"><label class="row"><span>Confirm before real X delete</span><input id="confirmDelete" type="checkbox" /></label></section>
  <main id="list"><div class="item muted">Loading…</div></main>
  <script src="popup.js"></script>
</body></html>
```

- [ ] **Step 2: Replace `src/popup.js`**

```js
import { countLeft } from './core/count.js';

const $ = (id) => document.getElementById(id);
let currentSettings = {};

function button(label, action, tweetId) {
  const el = document.createElement('button');
  el.textContent = label;
  el.addEventListener('click', async () => {
    if (action === 'done' && currentSettings.confirmRealDelete && !currentSettings.deleteConfirmed) {
      const approved = window.confirm('Remove this bookmark from X for real?');
      if (!approved) return;
    }
    el.disabled = true;
    const result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action, tweetId });
    await render();
    if (!result?.ok) showError(result?.error ?? 'Action failed');
    else if (action === 'done' && result.undoUntil) showUndo(tweetId, result.undoUntil);
  });
  return el;
}

function showError(message) {
  $('error').hidden = !message;
  $('error').textContent = message ?? '';
}

function showUndo(tweetId, undoUntil) {
  const undo = document.createElement('button');
  undo.textContent = 'Undo';
  undo.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action: 'undo', tweetId });
    await render();
    if (!result?.ok) showError(result?.error ?? 'Undo failed');
  });
  $('error').hidden = false;
  $('error').replaceChildren('Removed from X. ', undo);
  setTimeout(() => { if (Date.now() >= undoUntil) showError(null); }, Math.max(0, undoUntil - Date.now()));
}

function bookmarkRow(bookmark) {
  const row = document.createElement('article');
  row.className = 'item';
  const head = document.createElement('div'); head.className = 'item-head';
  const author = document.createElement('strong'); author.textContent = bookmark.author || bookmark.handle || 'Unknown';
  const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = `#${bookmark.saveRank}`;
  head.append(author, rank);
  const snippet = document.createElement('div'); snippet.className = 'snippet'; snippet.textContent = bookmark.text;
  const actions = document.createElement('div'); actions.className = 'actions';
  actions.append(button('Keep', 'keep', bookmark.id), button('Done', 'done', bookmark.id));
  row.append(head, snippet, actions);
  row.addEventListener('dblclick', () => chrome.tabs.create({ url: bookmark.url }));
  return row;
}

async function render() {
  const state = await chrome.runtime.sendMessage({ type: 'XBI_GET_STATE' });
  currentSettings = state.settings ?? {};
  const allBookmarks = Object.values(state.bookmarks ?? {});
  const bookmarks = allBookmarks
    .filter((bookmark) => state.cleared?.[bookmark.id]?.action !== 'done')
    .sort((a, b) => a.saveRank - b.saveRank);
  $('left').textContent = countLeft(state.bookmarks ?? {}, state.cleared ?? {});
  $('total').textContent = allBookmarks.length;
  $('lastSync').textContent = state.meta?.lastSync ? `Synced ${new Date(state.meta.lastSync).toLocaleString()}` : 'Never synced';
  $('confirmDelete').checked = state.settings?.confirmRealDelete ?? true;
  showError(state.meta?.syncError);
  $('list').replaceChildren(...(bookmarks.length ? bookmarks.map(bookmarkRow) : [Object.assign(document.createElement('div'), { className: 'item muted', textContent: 'No cached bookmarks yet. Open X, initialize capture, then Sync.' })]));
}

$('sync').addEventListener('click', async () => {
  $('sync').disabled = true; $('sync').textContent = 'Syncing…'; showError(null);
  const result = await chrome.runtime.sendMessage({ type: 'XBI_SYNC' });
  if (!result?.ok) showError(result?.error ?? 'Sync failed');
  $('sync').disabled = false; $('sync').textContent = 'Sync now';
  await render();
});

$('confirmDelete').addEventListener('change', async (event) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, confirmRealDelete: event.target.checked } });
});

chrome.storage.onChanged.addListener(() => void render());
void render();
```

- [ ] **Step 3: Build + manual verify**

Run: `npm run build`
Expected: build succeeds and popup static assets exist in `dist/`.

Manual: open popup on an X tab. Verify count, total, sync time/error, oldest-first rows, Sync now, toggle persistence, Keep, and Done. Verify user text renders as text (not executable HTML).

- [ ] **Step 4: Commit**

```bash
git add public/popup.html src/popup.js
git commit -m "feat: add bookmark progress and action popup"
```

## Task 14: hardening, empty/logged-out states, README + ToS, E2E checklist

**Files:**
- Modify: `src/selectors.js`, `src/content.js`, `src/ui/card.js`
- Create: `README.md`, `docs/E2E_CHECKLIST.md`

**Interfaces:**
- Produces fail-closed For You detection, empty/success status cards, first-run instructions, risk disclosure, and the final manual release gate.

- [ ] **Step 1: Tighten For You detection in `src/selectors.js`**

Replace `isHome` and add a pure label helper:

```js
export function isForYouLabel(label) {
  return label?.trim().toLowerCase() === 'for you';
}

export function isHome() {
  if (location.pathname !== '/home') return false;
  const selected = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')]
    .find((tab) => isForYouLabel(tab.textContent));
  return Boolean(selected); // Fail closed: never inject into Following or unknown layouts.
}
```

Add a small test to `tests/selectors.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { isForYouLabel } from '../src/selectors.js';

describe('isForYouLabel', () => {
  it('matches only the For You label', () => {
    expect(isForYouLabel(' For you ')).toBe(true);
    expect(isForYouLabel('Following')).toBe(false);
    expect(isForYouLabel(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Add a safe status card to `src/ui/card.js`**

```js
export function buildStatusCard(title, detail) {
  const card = node('article', null, 'padding:14px 16px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);border-left:3px solid #00ba7c;color:inherit;font:15px/1.4 system-ui');
  card.id = CARD_ID;
  card.append(node('strong', title), node('div', detail, 'opacity:.7;margin-top:3px'));
  return card;
}
```

In `pinRandomCard`, before returning on `!bookmark`, insert only the true completion state:

```js
  if (!bookmark) {
    if (Object.keys(state.bookmarks).length > 0 && countLeft(state.bookmarks, state.cleared) === 0) {
      firstCell.parentElement.insertBefore(buildStatusCard('Backlog cleared ✓', 'No saved bookmarks left to resurface.'), firstCell);
      handledThisHomeVisit = true;
    }
    return;
  }
```

Import `buildStatusCard` alongside `buildCardElement`. Do not inject an error/login card into the feed; show those in the popup so failures do not masquerade as X content.

- [ ] **Step 3: Create `README.md`**

```markdown
# X Bookmark Injector

A personal Chromium MV3 extension that puts one random saved X bookmark at the top of the **For You** feed. It shows the bookmark's chronological save rank (`#1 = oldest`), the tweet's posted date, and how many remain.

## Install

1. `npm install && npm run build`
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select `dist/`.
3. Keep the extension local/private. Do not publish it without replacing the internal-X integration.

## First-run initialization

The extension learns X's current private GraphQL operation IDs from your own logged-in browser session:

1. Log into `x.com` and reload once.
2. Open `x.com/i/bookmarks` once (captures `Bookmarks`).
3. On a disposable tweet, bookmark then unbookmark it once (captures `CreateBookmark` and `DeleteBookmark`).
4. Open the extension popup and press **Sync now**.

Repeat initialization if X rotates operation IDs and the popup reports a query failure.

## What the labels mean

- `Saved #12 of 87` is save **order**, derived from X's newest-first bookmark list. `#1` is oldest.
- `Posted Jun 21, 2026` is the tweet's real posted date.
- X does **not** expose the exact historical time you clicked Bookmark; this extension never invents it.

## Actions

- **Keep for later:** local 72-hour cooldown; the bookmark remains on X and still counts as left.
- **Done:** removes the real X bookmark after one-time confirmation. A six-second Undo re-creates it.

## Privacy and risk

All data stays in `chrome.storage.local`; network requests go only to `x.com`; there is no backend or telemetry. Bearer/CSRF session values remain in extension memory and are never committed or persisted.

This uses X's undocumented internal GraphQL endpoints and may violate X's Terms of Service. It is a low-rate personal tool, but account/action risk is real. X can break it by changing operation IDs, response shapes, anti-bot headers, or DOM selectors.

## iOS

The native X iOS app cannot host this extension. A future iOS companion would be a separate Swift widget/app using X's official OAuth API; Safari Web Extension support is technically possible but low-value because it cannot modify the native app.

## Development

- `npm test` — unit suite
- `npm run build` — production bundle in `dist/`
- `npm run watch` — rebuild while developing
- Release gate: `docs/E2E_CHECKLIST.md`
```

- [ ] **Step 4: Create `docs/E2E_CHECKLIST.md`**

```markdown
# Manual E2E Release Checklist

- [ ] `npm test` passes and `npm run build` succeeds from a clean checkout.
- [ ] Extension loads from `dist/` with no manifest/service-worker errors.
- [ ] No card on Profile, Search, Bookmarks, Following, or logged-out pages.
- [ ] Exactly one Hybrid card is first on For You; no duplicate while scrolling.
- [ ] Reloading Home chooses a random eligible item; rank is stable across reloads.
- [ ] Rank set is contiguous `1..N`; #1 matches oldest item in X Bookmarks.
- [ ] Posted date matches the tweet; no copy claims an exact bookmarked-at time.
- [ ] Count-left matches cached total minus Done; Keep does not decrement.
- [ ] Keep removes the card, leaves X bookmark, and observes cooldown.
- [ ] Done asks once, deletes from X only after success, and decrements count.
- [ ] Undo within six seconds restores X bookmark and local state.
- [ ] Failed delete leaves card/state unchanged and shows an error.
- [ ] Failed/partial/429 sync retains prior cache and reports a useful popup error.
- [ ] Empty completed backlog shows `Backlog cleared ✓`.
- [ ] Dark and light themes remain readable; media/text do not overflow at narrow width.
- [ ] Storage contains no Bearer, CSRF, cookie, or telemetry data.
- [ ] README first-run instructions work on a fresh extension profile.
```

- [ ] **Step 5: Run final objective gates**

Run: `npm test && npm run build && git diff --check`
Expected: all tests PASS, build succeeds, no whitespace errors.

Complete every item in `docs/E2E_CHECKLIST.md`. Any unchecked item blocks the completion claim; record external X/API blockers explicitly rather than marking them passed.

- [ ] **Step 6: Commit**

```bash
git add src/selectors.js src/content.js src/ui/card.js tests/selectors.test.js README.md docs/E2E_CHECKLIST.md
git commit -m "docs: harden feed targeting and add release runbook"
```

## Self-Review

### Spec coverage

| Approved requirement | Implemented by |
|---|---|
| Chromium MV3, least privilege, local-only | Tasks 1, 9, 14 |
| Intercept live X auth/query IDs; no paid API | Tasks 8, 11 |
| Page-session-safe request execution | Task 11 feasibility gate |
| Paginate/cache/dedupe/rank full backlog | Tasks 3–9, 12 |
| Random one-per-Home-load, top of For You only | Tasks 2, 7, 10, 14 |
| Save order #k of N + real posted timestamp + left count | Tasks 4, 6, 10 |
| Keep cooldown; real Done; one-time confirm; Undo | Tasks 7, 10, 12 |
| Popup count/sync/settings/list | Task 13 |
| Logged-out/empty/error/rate-limit/selector drift | Tasks 11, 12, 14 |
| ToS/privacy disclosure and iOS future-track note | Task 14 README |
| Unit/build/manual verification | Every TDD task + Task 14 release checklist |

### Placeholder scan

Reviewed after all task sections were written: no placeholders, deferred implementations,
vague test instructions, or "similar to another task" shortcuts remain.

### Type/interface consistency

- One mutation builder name everywhere: `buildMutationRequest(operation,auth,tweetId)`.
- One state shape everywhere: `{bookmarks,cleared,meta,auth:{queryIds},settings}`; Bearer/CSRF/templates stay memory-only.
- One bridge protocol everywhere: `XBI_AUTH_CAPTURE`, `XBI_PAGE_REQUEST`, `XBI_EXECUTE`, `XBI_EXECUTE_RESULT`.
- One action protocol everywhere: `XBI_ACTION` with `keep|done|undo`.
- Chrome 114 async listeners use `sendResponse` + `return true`, not Promise-return listeners.
- Captured operation templates supply changing X feature flags/body shape; dynamic cursor/tweet IDs are overwritten.

### Residual manual gates

The plan is executable, but no static test can prove X's undocumented live API contract. Task 11's HTTP-200 page-executor probe and Task 14's real-account E2E checklist are mandatory; failure stops the run and updates the fixture/parser/template capture rather than retrying blindly.
