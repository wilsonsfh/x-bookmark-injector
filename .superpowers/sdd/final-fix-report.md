# Final Fix Report

Date: 2026-07-12
Branch: `feat/x-bookmark-injector`
Code commits: `0c8f257db7c80076494c2b8cd6b4066b94d5fab2`, `60b36e6719a6b1a185895a2fb1272891a9b680a3`, `0ecebe3dcf7084f01f8bbb90e8af2b6c03449655`, `4c369a9ddb27670506d1af85e25058a0ab6766b9`
Status: Required final-review fixes implemented and committed. Live X validation remains intentionally unclaimed.

## Findings Closed

1. MV3 Undo durability
   - Pending Undo authorization is stored in `chrome.storage.session` for the six-second window.
   - Service-worker startup hydrates valid authorization and prunes expired records.
   - Stored records contain only Undo timing/recovery metadata and the bookmark snapshot; no auth, cookies, or request templates.
   - Rehydrated records install replacement expiry timers and project safe `{undoUntil,recovery}` state to the popup.

2. Durable delete saga
   - A non-sensitive `pendingActions` delete intent and bookmark snapshot is written to `chrome.storage.local` before calling X.
   - Known remote rejection clears the intent without changing the cache or cleared state.
   - Confirmed remote success establishes session Undo recovery before local Done publication.
   - Ambiguous/prepared state is reconciled conservatively on wake; it is never silently replayed as another delete.
   - Remote success followed by local publication failure returns `ok:true`, `recovery:true`, and `undoUntil`, so feed and popup expose Undo immediately.
   - Known pre-request failures clear their intent; uncertain post-dispatch outcomes alone enter explicit `phase:'reconciliation'` with bounded Undo timing.
   - Status `0`, `408`, `409`, `425`, `429`, and all `5xx` responses reconcile; only definite non-retryable `4xx` responses clear intent.
   - If `storage.session` fails after confirmed delete, local reconciliation stores `undoUntil` and the action still returns usable recovery metadata.
   - Uncertain post-dispatch outcomes immediately return `reconciliationPending` plus `undoUntil`; their marker is `reconciliation`, so count-left does not decrement and feed selection blocks repeat deletion.
   - This is a recovery saga, not a claim of atomicity across X and extension storage.

3. Sync versus Undo
   - Undo uses its persisted bookmark snapshot and reinserts it into the cache even when an intervening sync removed it.

4. Stale sync recovery
   - Sync writes `syncStartedAt` and clears it on success/error.
   - Missing, future, or at-least-five-minute-old `syncStartedAt` values recover to idle, allowing automatic sync to resume.
   - Undo cleanup is keyed by `requestedAt`, preventing an old timer from deleting a newer action for the same tweet.

5. Query rotation and rate limits
   - A Bookmarks 404 removes only the Bookmarks query ID, retains Delete/Create IDs and the old bookmark cache, and instructs recapture.
   - 429 handling uses at most three attempts with injectable 250 ms and 500 ms sleeps.

6. Tweet normalization
   - Blank IDs and ID-only/blank-content records fail normalization.
   - Text fallback and media-only valid variants remain accepted.

7. Feed focus
   - Undo receives focus immediately after Done removes its trigger.
   - Focus moves to the first real feed cell after successful Undo or expiry.
   - Content queries projected Undo at startup and on Home return, rendering/focusing recovery after a service-worker restart.
   - Uncertain-delete copy states that the outcome is uncertain and that Undo safely restores.

8. Engagement row
   - Safe reply, repost, like, view, and bookmark counts are normalized.
   - Missing/invalid metrics are omitted; visible compact values have full accessible labels.

9. Random-only spec consistency
   - Removed the stale architecture bullet's `direction toggle`; the delete-confirmation toggle remains.

## TDD Evidence

Each new behavior was observed failing before implementation. Representative red failures included:

- Restarted Undo returned `Undo window expired`.
- Delete intent was absent before mutation.
- Rejected remote delete left a prepared intent.
- Local/session phase failures lacked restart reconciliation.
- Stale `syncing` state suppressed the expected automatic sync.
- A 429 rejected immediately instead of retrying.
- A 404 retained the stale Bookmarks query ID.
- ID-only normalization returned a bookmark instead of `null`.
- Engagement metrics rendered as an empty list.
- Feed focus remained on the document body instead of Undo/feed.
- Remote-success/local-failure returned only an error instead of a usable Undo response.
- Restarted popup state omitted the recovered Undo control.
- Pre-request failures retained prepared intents, while uncertain dispatch remained only `prepared`.
- Rehydrated records had no replacement cleanup timer and old cleanup could not identify its originating intent.
- HTTP 5xx/retryable statuses were incorrectly treated as definite rejection.
- Feed content did not query projected Undo after worker restart/Home return.
- Confirmed delete plus `storage.session` failure returned only an error despite durable local intent.
- Uncertain post-dispatch responses still surfaced as failure and incorrectly used a confirmed `done` marker.
- Successful CreateBookmark/local restore was reported as failed when session cleanup remained unavailable.

Focused final run:

```text
npx vitest run tests/background.test.js tests/popup.test.js tests/content.test.js
4 test files passed; 155 tests passed; 0 failed.
```

Full final run:

```text
npm test
15 test files passed; 280 tests passed; 0 failed.
```

Security/restart-focused run:

```text
5 test files passed; 27 selected tests passed; 134 skipped; 0 failed.
```

## Build And Audits

- `npm run build`: passed; `build complete -> dist/`.
- `git diff --check`: passed with no output.
- Static storage inspection: `storage.session` writes only `pendingUndo`; records are limited to `undoUntil`, `recovery`, `requestedAt`, and the bookmark snapshot.
- Static local-storage inspection: auth writes remain `{ auth: { queryIds } }`; session Bearer, CSRF, operation headers, operation templates, and cookies are not persisted.
- Existing security tests confirm session material is memory-only and default-state loading excludes credentials/templates.
- Spec scan for `direction toggle`: no matches.
- Dev tooling is now `esbuild@0.25.0` and `vitest@3.2.6`; both declare Node 18 support.
- Vite is overridden to `6.4.3` because unconstrained resolution selected Vite 7 (Node 20.19+). Vite 6.4.3 supports Node 18 and uses `esbuild ^0.25.0`.
- `npm audit`: `found 0 vulnerabilities`. No `--force` or audit bypass was used.

## Self-Review

- Scope remained limited to the nine review findings, regression tests, and the single contradictory spec phrase.
- Existing behavior is preserved by the complete 280-test suite.
- No auth/cookie/template persistence, broad host permission, telemetry, or backend was added.
- No E2E checklist boxes were changed and no live X result was fabricated.

## Residual Blockers

- The 21 manual/live checks in `docs/E2E_CHECKLIST.md` remain open, including logged-in X capture, Bookmarks sync, real DeleteBookmark/CreateBookmark, theme, and SPA behavior.
