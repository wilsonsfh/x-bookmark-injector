# Progress Report

## Status at a glance

| Area | Status | Evidence |
| --- | --- | --- |
| Native Option B read/sync loop | Live accepted | Author/avatar, pagination, first-position card, Read more/Show less and exact-status navigation passed in logged-in X |
| Quoted/re-roll, link preview, auto-sync | Pushed; live verification pending | Committed `14d833b`; passes gate but owner has not yet reloaded `dist/` and verified on live X |
| Automated verification | Green | 313/313 tests, build passed, audit 0, diff check passed |
| Source publication | Shipped | Public `wilsonsfh/x-bookmark-injector`, default branch `main`; all commits attributed to GitHub user `wilsonsfh` |
| Destructive actions | Manual gate open | Keep, real Delete, Undo and failure paths remain unchecked in `docs/E2E_CHECKLIST.md` |

## Completed

### 2026-07-13

- Enriched the injected card and automated syncing on branch `main` at commit `14d833b`
  (pushed to `origin/main`, `d973209..14d833b`): inline expandable quoted post
  (`Show quoted post`), `Show another bookmark` re-roll, and a native link/article
  preview (thumbnail, domain, title) that replaces bare `t.co` shortlinks.
  Files: `src/{content,inpage,storage}.js`, `src/core/{normalize,selection}.js`,
  `src/ui/card.js`, plus tests, README and `docs/E2E_CHECKLIST.md`.
- Added event-driven auto-sync: the MAIN world detects same-device
  `CreateBookmark`/`DeleteBookmark` and the content script debounces a sync (15s,
  min 30-min gap); the extension's own mutations bypass detection so there is no loop.
- Lowered the on-Home staleness backstop from 24h to 12h; its main job is catching
  bookmarks changed on other devices (e.g. mobile) that the same-device detector
  cannot observe.
- Hardened after review: one shared Keep/Done/re-roll lock, a stale-re-roll ownership
  guard, isolated quoted/card/article parsing (fail closed), and focus restoration.
- Verified 313/313 tests, production build, `npm audit` 0 vulnerabilities, and
  `git diff --check` before pushing. New card/sync behaviors await owner live E2E.

### 2026-07-12

- Shipped the Zara-faithful native bookmark resurfacer on branch `main` at commit
  `920896a2f85c4751ca370ddedc4cfac6f2d24cf0` to
  <https://github.com/wilsonsfh/x-bookmark-injector> (public).
- Added the production README covering motivation, setup, tech stack, architecture,
  data/session boundaries, main flows, project structure and rejected alternatives.
- Verified `npm ci`, 290/290 tests, production build, `npm audit` with 0
  vulnerabilities, production secret scan and `git diff --check` before publication.
- Live-accepted current-X author normalization, bounded pagination, authenticated-tab
  fallback, native Option B rendering, six-line expansion and exact-status navigation.
- Rewrote all 41 historical author/committer identities to
  `wilsonsfh <74759808+wilsonsfh@users.noreply.github.com>`, force-pushed with lease,
  and verified GitHub associates every remote commit with `wilsonsfh`.

## Remaining gates

- Complete the unchecked destructive-action, route/theme, error-state and storage
  inspection items in `docs/E2E_CHECKLIST.md` before treating Done/Undo as released.
