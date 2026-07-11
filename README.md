# X Bookmark Injector

A private Chromium MV3 extension that puts one random saved X bookmark at the top of the **For You** feed as a simple native-looking post. It shows the bookmark's save-order rank, the post's published date, and how many cached bookmarks remain.

## Release status

The 2026-07-12 live run confirmed that the unpacked extension loads, captures current X data, completes pagination, injects Option B first on Home, shows the real author, opens the exact bookmarked status from the post body, and expands/collapses long text with a six-line Read more treatment. The full checklist—including the real DeleteBookmark/CreateBookmark Undo round trip—remains open in [`docs/E2E_CHECKLIST.md`](docs/E2E_CHECKLIST.md). Do not trust **Done · Remove** with important bookmarks until those destructive-action checks are completed.

## What it does

- Injects exactly one random eligible bookmark before the first real post in **For You**.
- Looks like a normal X post rather than a separate dashboard card.
- Shows stable save-order position (`#k of N`), the post's published date, and remaining count.
- Renders current X author/avatar fields, Note Tweet text, first media item, alt text, and available engagement counts.
- Clamps long posts to six rendered lines with `Read more` / `Show less`.
- Opens the exact bookmarked status from the full non-action body or `Open on X` control.
- Keeps a bookmark locally for later or removes it from X with a bounded Undo/reconciliation path.
- Provides a popup for sync status, counts, oldest-first browsing, settings, and recovered Undo.

## Tech stack

| Layer | Technology | Why |
| --- | --- | --- |
| Extension | Chromium Manifest V3 | Native content scripts, MAIN/ISOLATED worlds, service worker, popup, local/session storage |
| Language | JavaScript ES modules | Small dependency surface and direct browser APIs |
| Bundling | esbuild 0.25 | Produces Chrome-114-targeted IIFE entry bundles in `dist/` |
| Tests | Vitest 3.2 | Fast pure-core, fake-DOM, message-bridge, service-worker, race and recovery tests |
| Persistence | `chrome.storage.local` + `chrome.storage.session` | Durable cache/settings/intents plus restart-safe, time-bounded Undo authorization |
| X integration | Captured internal GraphQL request templates | Reuses the logged-in page session without a project backend or developer app |
| UI | Semantic DOM + scoped CSS | Native X anatomy, theme inheritance, safe `textContent`, accessible controls |

Runtime dependencies are deliberately zero; esbuild/Vitest/Vite are development-only. `npm audit` reports zero known vulnerabilities at the verified lockfile.

## Architecture

```text
┌──────────────────────────── x.com page ────────────────────────────┐
│ inpage.js (MAIN world)                                             │
│ • observes X's own allowlisted GraphQL requests                    │
│ • captures bounded operation IDs/headers/templates in memory       │
│ • executes only validated https://x.com/i/api/graphql/* requests   │
└───────────────────────────┬────────────────────────────────────────┘
                            │ validated window bridge
┌───────────────────────────▼────────────────────────────────────────┐
│ content.js (ISOLATED world)                                       │
│ • relays page requests/results                                    │
│ • detects Home + selected For You tab                             │
│ • selects one random eligible bookmark and pins the native card   │
│ • owns Read more, Keep, Done confirmation, and Undo feedback       │
└───────────────────────────┬────────────────────────────────────────┘
                            │ chrome.runtime messages
┌───────────────────────────▼────────────────────────────────────────┐
│ background.js (MV3 service worker)                                │
│ • resolves an authenticated X tab                                 │
│ • paginates/sanitizes/deduplicates/ranks transactionally           │
│ • serializes sync/settings/actions                                │
│ • runs the durable Delete → reconcile → Undo saga                 │
└───────────────┬──────────────────────────────┬─────────────────────┘
                │                              │
     chrome.storage.local            chrome.storage.session
     cache, rank, settings,           active Undo authorization
     query IDs, durable intents       and expiry window
                │
┌───────────────▼────────────────────────────────────────────────────┐
│ popup.js + popup.html                                              │
│ progress, sync/errors, oldest-first list, actions, recovered Undo  │
└────────────────────────────────────────────────────────────────────┘
```

### Component boundaries

| Module | Responsibility |
| --- | --- |
| `src/core/*` | Pure normalization, ranking, merge, count and random/cooldown selection |
| `src/x-api/*` | Authenticated request construction and strict bookmark response parsing |
| `src/bridge.js` | Sanitized capture schema and request/result validation across worlds |
| `src/inpage.js` | MAIN-world interception and constrained page-session fetch executor |
| `src/content.js` | Timeline lifecycle, card insertion, post interaction and page relay |
| `src/background.js` | Sync orchestration, persistence, retries, mutation saga and messaging |
| `src/ui/card.js` | Native post rendering, safe URLs/media, line clamp and accessible actions |
| `src/popup.js` | Progress dashboard, sync/settings controls and destructive-action gating |

### Main flows

**Sync:** popup/content requests sync → background resolves a captured X tab → MAIN world executes paginated Bookmarks requests → every page is schema-validated → duplicate IDs are removed → ranks are assigned (`#1 = oldest`) → the cache is published only after the complete run succeeds. Failed, malformed, rate-limited, partial, or stale-query runs retain the previous cache.

**Feed:** content detects `/home` with the **For You** tab selected → filters Done/reconciliation/cooling-down records → chooses through injected `Math.random` → builds one native post → keeps it first through timeline replacement without duplicating it.

**Delete/Undo:** background persists a pre-mutation intent and bookmark snapshot → sends `DeleteBookmark` → accepts only the exact operation-specific success schema → publishes Done + a six-second Undo window. MV3 restarts, local/session storage failures, concurrent sync, and ambiguous 5xx/post-dispatch outcomes retain a truthful reconciliation/restore path. `CreateBookmark` success restores both X and local cache state.

## Tradeoffs considered

| Decision | Chosen | Rejected alternatives | Tradeoff |
| --- | --- | --- | --- |
| X access | Intercept and replay the logged-in page's internal GraphQL | Official OAuth API; DOM scraping | No developer app/cost and preserves media/context, but undocumented endpoints may violate X policy and can change |
| Request execution | MAIN-world constrained fetch | Service-worker cross-origin fetch | Reliable page cookies/session semantics, at the cost of a validated `postMessage` bridge |
| Storage | Local-only extension state | Project backend/cloud sync | No server/telemetry/secrets service; state is profile-local and not multi-device |
| Surfacing | Random eligible bookmark per Home load | Oldest-only, newest-only, every-N-post injection | Discovery stays fresh; chronological rank keeps the random choice legible |
| Card design | Zara-faithful native Option B | Hybrid rail/tint/chips; ultra-minimal text actions | Blends into the feed while retaining visible Keep/Remove actions; less visual separation from X content |
| Long text | Six rendered-line clamp + measured overflow | Hard character cut; always full text; open-only | Preserves words/languages and feed rhythm, with a small ResizeObserver/toggle interaction |
| Parsing | Strict allowlisted schema, fail closed | Permissive recursive extraction | Protects cache integrity but may require updates when X adds a new valid entry shape |
| Pagination | Bounded 100-page loop; repeated cursor accepted only with zero new IDs | Always reject repeats; unlimited pagination | Handles X's live terminal repeat without allowing infinite/new-data loops |
| Mutations | Durable intent/reconciliation saga | Memory-only Done/Undo; optimistic local mutation | Handles MV3 restarts and partial failures, but adds state-machine complexity |
| iOS | Separate future native/official-API companion | Pretend Chromium extension can modify native X app | Honest platform boundary; no native-app support today |

## Project structure

```text
manifest.json            MV3 permissions and entrypoints
build.mjs                deterministic src/public → dist build
src/                     extension source by responsibility
tests/                   290 unit/integration/race/recovery tests
fixtures/                trimmed X GraphQL response fixture
public/popup.html         popup shell and scoped styling
docs/E2E_CHECKLIST.md     live release evidence gate
docs/mockups/             visual comparisons and selected Option B
docs/superpowers/         approved design spec and implementation history
```

## Verification snapshot

Verified on 2026-07-12:

```text
npm test                         290/290 passed (15 files)
npm run build                    passed
npm audit --audit-level=moderate 0 vulnerabilities
git diff --check                 passed
```

Live Option B evidence: extension load, current-X capture, HTTP-200 pagination, author/avatar, first-position native post, exact-status body/Open navigation, and six-line Read more/Show less passed. Destructive and broader route/theme/storage checks remain tracked in the E2E checklist.

## Install locally

1. Run `npm install && npm run build`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`.
3. Keep the extension local and private. Do not publish it without replacing the internal-X integration and completing an appropriate policy/security review.

## First-run capture

The extension learns X's current private GraphQL operation IDs from requests made by your own logged-in browser session:

1. Log into `x.com`, then reload the page once so the extension can observe session request headers.
2. Open `https://x.com/i/bookmarks` once to capture `Bookmarks`.
3. On a disposable post, bookmark it and then unbookmark it once to capture `CreateBookmark` and `DeleteBookmark`.
4. Keep an `x.com` tab active, open the extension popup, and press **Sync now**.

Repeat these steps if X rotates operation IDs or the popup reports missing capture or query failures. Capture is passive: the extension does not ask you to paste credentials.

## Label semantics

- `Saved #12 of 87` is a relative save-order rank from the most recent complete X Bookmarks response, which X returns newest-saved first. The extension reverses that list for ranking, so `#1` means the oldest saved item in that synced response.
- Save rank is not a bookmark timestamp. X does not expose the historical date or time when you clicked Bookmark, and this extension does not infer or invent one.
- `Posted Jun 21, 2026` comes from the post's `created_at` value and is formatted as a UTC calendar date. It describes when the post was published, not when it was bookmarked.
- `N left` is the cached bookmark count minus items successfully marked Done. Keep for later does not reduce it.

## In-feed design

The injected item deliberately follows normal X post anatomy: avatar, author/handle,
published date, text/media, engagement, then a compact `Open on X ↗` / `Keep for later` /
`Done · Remove` footer. The only extension-specific context is one muted line:
`From your bookmarks · #k of N · N left`. There is no accent rail, tinted card
background, chip row or dashboard shell. Long posts clamp to six rendered lines;
`Read more` expands in place and `Show less` collapses them. The whole non-action post
body also opens the exact bookmarked X status for quotes, reposts and conversation context.

## Actions

- **Keep for later:** records a local 72-hour cooldown. The bookmark remains saved on X and still counts as left. If every remaining item is cooling down, one may be resurfaced rather than leaving the feed empty.
- **Done:** after the configured one-time confirmation, calls X's delete-bookmark mutation. Local Done state changes only after X reports success. A six-second Undo calls X's create-bookmark mutation and restores local state after X reports success.
- **Backlog cleared:** appears only when a non-empty cached backlog is fully Done and sync metadata has no error. Bookmark, Done/Undo, and sync metadata changes re-evaluate this status; login and sync failures remain popup-only.

## Local data and session boundaries

There is no project backend or telemetry. `chrome.storage.local` in the current browser profile stores cached bookmark content and metadata, save ranks, Keep/Done records and timestamps, settings, sync status/errors, and captured GraphQL operation IDs. This data is local to the extension profile, but it is not an encrypted secrets vault.

Bearer and CSRF values, captured replay headers, and operation templates remain only in extension/content-script memory for the current browser/page/service-worker sessions. They are never written to `chrome.storage.local` or the repository. X cookies remain browser-managed and are not copied into extension storage. Extension API calls are sent through the active X page to `x.com`; rendered post media may load from allowlisted X/Twitter media hosts. Links open X/Twitter directly.

## X policy and account risk

This tool uses X's undocumented internal GraphQL endpoints rather than a supported public API. That use may violate X's Terms of Service or automation rules. Low-rate personal use does not remove the risk: requests can be rejected or rate-limited, behavior can trigger enforcement, and the account may be restricted or suspended. X can also break the extension at any time by changing operation IDs, request requirements, response shapes, or DOM selectors. Use only with an account and bookmarks whose risk you accept.

## iOS limitation

The native X iOS app cannot host this Chromium extension, and Chrome on iOS does not support loading it. No iOS companion currently exists. A separately converted Safari Web Extension could affect the `x.com` website in Safari, but it still could not modify the native X app.

## Development

- `npm test`: run the unit suite.
- `npm run build`: create the Chrome 114-targeted production bundle in `dist/`.
- `npm run watch`: rebuild while developing.
- [`docs/E2E_CHECKLIST.md`](docs/E2E_CHECKLIST.md): required live manual release gate.
