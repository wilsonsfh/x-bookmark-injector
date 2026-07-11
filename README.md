# X Bookmark Injector

A private Chromium MV3 extension that puts one random saved X bookmark at the top of the **For You** feed. It shows the bookmark's save-order rank, the post's published date, and how many cached bookmarks remain.

## Release status

The code has automated unit and build coverage, but the current undocumented X integration has **not** passed the live logged-in manual gate. Live operation capture, one successful Bookmarks request and full sync, selector/visual checks on the current X UI, and a real DeleteBookmark/CreateBookmark Undo round trip remain unchecked in [`docs/E2E_CHECKLIST.md`](docs/E2E_CHECKLIST.md). Treat this as unreleased and do not trust **Done** with important bookmarks until that checklist is completed.

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

## Actions

- **Keep for later:** records a local 72-hour cooldown. The bookmark remains saved on X and still counts as left. If every remaining item is cooling down, one may be resurfaced rather than leaving the feed empty.
- **Done:** after the configured one-time confirmation, calls X's delete-bookmark mutation. Local Done state changes only after X reports success. A six-second Undo calls X's create-bookmark mutation and restores local state after X reports success.

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
