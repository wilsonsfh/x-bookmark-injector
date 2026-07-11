# X Bookmark Injector — Design Spec

- **Status:** draft (awaiting owner review)
- **Date:** 2026-07-10
- **Owner:** Wilson Soon
- **Author:** OpenCode (brainstorming session)
- **Type:** Personal project — Chromium MV3 browser extension

## 1. Problem

X bookmarks are a write-only graveyard: easy to save, never revisited. The save
button is a dopamine off-ramp ("I'll read it later") and "later" never comes. The
backlog grows to hundreds and becomes too intimidating to open. See
[[digital-minimalism-and-dopamine]].

## 2. Goal & success criteria

Resurface saved bookmarks inside the one surface the owner already checks dozens of
times a day — the **For You** feed — so they actually get read and cleared. The
mechanic is deliberately adtech-flavoured ("inject like an ad, hijack real estate I
already check 50× a day"), see [[adtech-and-real-time-bidding]].

**Success:**
- Every time X's Home loads, exactly one saved bookmark is pinned at the very top of
  the For You feed, styled to belong there.
- Each surfaced bookmark shows: its **save rank** (order #k of N), the tweet's
  **posted timestamp**, and **how many bookmarks are left**.
- One click clears it — either **Done (remove from X for real)** or **Keep for
  later (dismiss locally)** — and the backlog count visibly shrinks.
- All data stays local; no server, no paid API tier, no dev app.

**Non-metric north star:** the owner reads and drains the bookmark backlog instead
of hoarding it.

## 3. Users & context

Single user: the owner ([[wilson-soon]]). Web/TS-native (Workers/React/Vite/Hono),
comfortable in Chromium DevTools. Already scoped X bookmarks via the **official** API
in [[AppleNotestoX]] (`GET /2/users/{id}/bookmarks`, OAuth2 PKCE, `bookmark.read`),
and previously considered a browser-session approach — this project takes the
browser-session path. Uses X heavily on desktop; also asked about iOS (see §5).

## 4. Scope

**In scope (v1):**
- Chromium MV3 extension for `x.com` (desktop).
- Read bookmarks via the logged-in session (internal GraphQL).
- Pin one random, not-yet-cleared bookmark at the top of For You on each Home load.
- Card shows save rank (#k of N), posted timestamp, count left; Done + Keep buttons.
- Local sync + cache of the full bookmark list; `DeleteBookmark` on Done.
- Popup: count left, last sync, "Sync now", basic list, one-time delete confirm.

**Out of scope (v1):**
- iOS / native app (see §5 — future track).
- Firefox / Safari builds (Chromium only).
- Feed-mixed "every N posts" mode (chose one-card-on-open; could add later).
- Cloud sync / multi-device / any backend.
- Categorization, tags, search, AI summarization of bookmarks (future).

## 5. Platform scope & iOS feasibility

v1 is **desktop Chromium only**. iOS was asked about; honest feasibility:

| Target | Feasible? | Notes |
|--------|-----------|-------|
| Native X iOS app | ❌ No | No extension injection into a native app; needs jailbreak/modded IPA. Out of scope. |
| iOS Safari (x.com) | ⚠️ Technically | Port content script as a **Safari Web Extension** (Xcode target). But users use the app, not Safari on iOS → low value. |
| iOS native companion | ✅ Separate project | Swift app + **widget/Shortcut/notification** using the **official** X API to surface one bookmark. Needs dev app / possibly paid tier. Realistic iOS route; ties into [[AppleNotestoX]]. |

**Decision:** iOS is a **future track**, not v1. If pursued, the native-widget path
(official API) is preferred over a Safari Web Extension.

## 6. Approaches considered

How the extension reads/writes bookmarks using the logged-in session:

| # | Approach | Robustness | Decision |
|---|----------|-----------|----------|
| **1** | **Intercept + replay.** MAIN-world script monkey-patches `fetch`/`XHR`, captures the app's Bearer, `x-csrf-token` (`ct0`), and the live `Bookmarks`/`DeleteBookmark` `queryId`; extension replays paginated reads + delete writes. | High — learns `queryId` live, survives X's frequent rotations. | ✅ **Chosen** |
| 2 | **Hardcoded** public web Bearer + `queryId` scraped from the JS bundle. | Medium — breaks on `queryId` rotation; needs manual upkeep and commits auth-like material. | ✗ Rejected after security review |
| 3 | **DOM scrape** the Bookmarks page. | Low — virtualized list, brittle, hard to paginate headlessly. | ✗ Rejected |

**Chosen: #1 (intercept + replay), with no committed Bearer fallback.**
Rationale: the fragile part of X's private API is the rotating `queryId`; learning it
from the app's own traffic makes the extension self-healing without upkeep.

## 7. Architecture

Chromium MV3. Four cooperating units, each with one clear job:

```
x.com page
 ├─ inpage.js   (MAIN world)     → captures auth/templates + executes constrained GraphQL
 ├─ content.js  (ISOLATED world) → bridges messages + owns card UI/timeline observer
 ├─ background.js (service worker)→ throttled sync, pagination, cache merge
 └─ popup.html/.js               → dashboard: count, sync, settings, list
        └─ chrome.storage.local  → all state (local only)
```

- **`inpage.js` (MAIN world)** — owns auth discovery and constrained request execution. Monkey-patches
  `window.fetch` + `XMLHttpRequest.prototype.open/setRequestHeader/send`. On any X
  GraphQL call it captures: `authorization` Bearer, `x-csrf-token`, other required
  `x-twitter-*` headers, and the operation→`queryId` map (esp. `Bookmarks`,
  `DeleteBookmark`, `CreateBookmark` for undo), plus safe request templates (feature
  flags/body shape). It executes only validated `https://x.com/i/api/graphql/*`
  requests so X's page-session cookies are reliable. Emits via `window.postMessage`;
  holds no bookmark data.
- **`content.js` (ISOLATED world)** — bridges MAIN-world messages to the extension; owns a
  `MutationObserver` on the primary column; detects the For You timeline and SPA route
  changes (`x.com/home`); builds + pins the bookmark card as the first
  `cellInnerDiv`-styled node and wires Done/Keep.
- **`background.js` (service worker)** — owns sync: paginate `Bookmarks` via cursor,
  normalize tweets, assign `saveRank`, merge into `chrome.storage.local` (dedupe on
  tweet id), throttle (default: once per day or on manual "Sync now"). Runs
  `DeleteBookmark` on Done.
- **`popup`** — reads storage: count left, last sync time, "Sync now" button,
  one-time "confirm real deletes" setting, scrollable list.

## 8. Data flow

**Auth discovery:** `inpage.js` observes the app's own request → posts `{bearer,
csrf, headers, queryIds, operationTemplates}` → `content.js`/`background` cache it
(session-scoped; only `queryIds` persisted as last-known-good). First run asks the
owner to open Bookmarks and bookmark/unbookmark a disposable tweet once to capture
all three operations.

**Sync (background + page executor):** trigger (first run / daily / manual) →
background builds each request; content relays it; MAIN world executes it with the
page session → `Bookmarks` query paginated by `cursor` → normalize each tweet `{id,
url, text, author, handle, avatar,
createdAt, media}` → assign `saveRank` (see §10) → merge into cache, mark items no
longer present as removed → write `meta.lastSync`.

**Inject (content):** on Home load / SPA nav to `/home` → read cache → filter to
not-`done`, not-in-`keep`-cooldown → pick **random** → build card → pin as first cell
→ render stats.

**Actions:**
- **Done** → (optional one-time confirm) → `DeleteBookmark(id)` → on success mark
  `cleared[id]={action:'done',at}` → decrement count → toast with **Undo**
  (`CreateBookmark(id)` within a few seconds).
- **Keep for later** → `cleared[id]={action:'keep',at}` + cooldown → remove card, no
  network call, bookmark stays in X.

## 9. Storage schema (`chrome.storage.local`)

```jsonc
{
  "bookmarks": {                 // keyed by tweet id
    "1806...": {
      "id": "1806...",
      "url": "https://x.com/zarazhangrui/status/1806...",
      "text": "I hoard X bookmarks...",
      "author": "Zara Zhang",
      "handle": "@zarazhangrui",
      "avatar": "https://pbs.twimg.com/...",
      "createdAt": "2026-06-21T13:37:00Z", // tweet posted time (reliable)
      "media": [{ "type": "photo", "url": "..." }],
      "saveRank": 12,            // 1 = oldest saved ... N = newest saved
      "fetchedAt": "2026-07-10T..." 
    }
  },
  "cleared": { "1806...": { "action": "done|keep", "at": "2026-07-10T..." } },
  "meta": { "total": 87, "lastSync": "2026-07-10T...", "lastCursor": null },
  "auth": { "queryIds": { "Bookmarks": "abc", "DeleteBookmark": "def", "CreateBookmark": "ghi" } },
  "settings": {
    "confirmRealDelete": true,   // one-time confirm before first real delete
    "keepCooldownHours": 72,     // how long "Keep" hides an item
    "syncEveryHours": 24,
    "cardStyle": "hybrid"        // locked v1 default
  }
}
```

Data is **local only** — no network egress except to `x.com` itself.

## 10. Feature spec

**Save rank / "order #k of N" (chronological save order).** X's `Bookmarks` returns
items newest-saved-first (LIFO). We reverse to assign `saveRank` where **#1 = oldest
saved**, **N = newest saved**. The card shows e.g. `Saved #12 of 87` = the 12th-oldest
bookmark. *Order is reliable (it's the list position); the exact "bookmarked-at" clock
time is NOT returned by X and is never fabricated.*

**Timestamp.** The card shows the tweet's real **posted** date (`createdAt`). Items
cleared going forward also get a local action timestamp.

**How many left.** `count(bookmarks) − count(cleared where action=done)`. Shown on the
card and in the popup. (Kept items still count as "left".)

**Random surfacing.** Each Home load picks a uniform-random item from
not-`done` ∧ not-in-active-`keep`-cooldown. If all are cooled down, ignore cooldown.
If none left, show a celebratory empty state ("Backlog cleared 🎉").

**Buttons.** `Done ✓ (remove from X)` → real delete + Undo toast. `Keep for later` →
local dismiss + cooldown.

**Popup dashboard.** Count left, last sync, "Sync now", one-time delete-confirm
toggle, and a scrollable list (author, snippet, save rank, Done/Keep per row).

## 11. UX / card design

**Locked v1 default (changeable):** **Hybrid** style — a native-looking post so it
belongs in the feed, but carrying B's stat chips and always-visible Done/Keep buttons
— **pinned at the very top of the For You feed** (above the first real post) on each
load. Reference mockup: `docs/mockups/2026-07-10-injected-card-directions.html`.

Card anatomy: `📌 From your bookmarks` provenance label · `Saved #12 of 87 · 12th
oldest` rank chip · `74 left` chip · avatar/name/handle · text + media · original
engagement row · `posted <date>` · `Keep for later` + `Done ✓ (remove from X)`.

Must visually track X's current dark/light theme and not shift layout when dismissed
(smooth collapse).

## 12. Edge cases & failure modes

- **Logged out / no session** → don't inject; popup shows "Log in to X to sync".
- **Zero bookmarks / all cleared** → empty-state card ("Backlog cleared 🎉"), no pin.
- **`queryId` rotated** → interception relearns it on next app call; if a replay 404s,
  invalidate cached `queryId` and guide the owner through safe re-capture. No committed Bearer fallback.
- **Rate limiting (429)** → exponential backoff on sync; never block the UI.
- **SPA navigation** → observe `document.title`/URL + timeline node; re-pin only on
  For You Home, remove card when navigating away; guard against duplicate injection.
- **DOM/selector drift** → centralize selectors in one module; feature-detect and
  no-op gracefully if the timeline node isn't found.
- **Delete fails** → keep the card, surface an error toast, do not mark done.
- **Media/quote tweets/long text** → render text + first media thumbnail; link out for
  the rest; never break layout.
- **Duplicate sync races** → single in-flight sync lock in the service worker.

## 13. Security, privacy & ToS

- **Local-only.** All bookmarks + state live in `chrome.storage.local`. No backend, no
  telemetry, no third-party egress. Network calls go only to `x.com`.
- **Least privilege.** `host_permissions` limited to `https://x.com/*` (+ legacy
  `https://twitter.com/*`), plus `storage`. No broad `<all_urls>`.
- **Secrets.** Auth (Bearer/`ct0`) is the user's own session, captured in-page, held in
  memory / local storage, never transmitted anywhere but X. Not committed to git.
- **ToS (honest).** Using X's internal/undocumented endpoints is **against X's Terms of
  Service**. Risk is low for personal, local, human-rate use, but real (theoretical
  account action). Documented in the README. No automation beyond user-initiated syncs.
- **Destructive action.** "Done" deletes the real bookmark; gated by a one-time confirm
  + an Undo toast (`CreateBookmark`).

## 14. Testing strategy

- **Unit (Vitest):** `saveRank` assignment (LIFO→oldest-first), count-left math,
  random-selection filter (excludes done + cooldown), storage merge/dedupe, cooldown
  expiry.
- **Pure core:** keep selection/ranking/merge logic in framework-free modules so they
  test without a browser.
- **Manual E2E checklist:** load on `x.com/home` → card pins at top; Done removes from X
  (verify in real Bookmarks) + Undo restores; Keep hides for cooldown; count decrements;
  logged-out + empty states; theme switch; SPA nav in/out.
- **Resilience probe:** simulate stale `queryId` (force 404) → confirm fail-closed error + re-capture path.

## 15. Milestones (thin vertical slices)

1. **M1 — Skeleton:** MV3 manifest, content script injects a static "hello" card pinned
   at top of For You; popup shell. _Verify: card appears on Home._
2. **M2 — Auth capture:** `inpage.js` captures Bearer/`ct0`/`queryId` without logging secrets.
   _Verify: operation names/IDs captured on initialization; persisted storage contains IDs only._
3. **M3 — Read + cache:** background syncs bookmarks (paginate), assigns `saveRank`,
   stores. Popup shows count + list. _Verify: counts match real bookmarks._
4. **M4 — Real card:** render a random cached bookmark (rank, timestamp, count) in the
   Hybrid card. _Verify: matches mockup + real data._
5. **M5 — Actions:** Keep (local + cooldown); Done (`DeleteBookmark` + confirm + Undo).
   _Verify: X bookmarks actually change; Undo restores._
6. **M6 — Hardening:** edge cases, backoff, selector module, empty/logged-out states,
   README (incl. ToS note). _Verify: manual E2E checklist green._

## 16. Open questions & risks

- **`queryId`/selector drift** is the top maintenance risk — mitigated by interception
  + centralized selectors, but X can still break it; accept as a known cost.
- **Undo window** length for Done (default ~6s) — tune in use.
- **"Keep" cooldown** default (72h) — tune in use.
- **Sync cadence** vs rate limits — start daily + manual; revisit.
- **Card style** — Hybrid is the locked default; trivially swappable to A/B via
  `settings.cardStyle` if it feels wrong in real use.

## 17. Wiki cross-links

- Concepts: [[digital-minimalism-and-dopamine]], [[adtech-and-real-time-bidding]],
  [[ui-design-taste-deslop]], [[personal-operating-system]].
- Projects: [[ai-agent-project-ideas]] (sibling buildable-project backlog), and a new
  project page `x-bookmark-injector`.
- Entities: [[wilson-soon]], [[AppleNotestoX]] (prior X-bookmarks + Swift work).
