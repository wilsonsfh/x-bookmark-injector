# Manual E2E Release Checklist

Check an item only after performing the stated clean-checkout or live-browser verification against the current X implementation. The 2026-07-12 native-card run verified load, HTTP-200 sync/pagination, first-position rendering, current-X author fields and exact-status navigation; destructive actions remain unchecked.

- [ ] `npm test` passes and `npm run build` succeeds from a clean checkout.
- [x] Extension loads from `dist/` in Chromium with working popup, content script and service worker.
- [ ] Fresh-profile initialization captures Bearer/CSRF plus `Bookmarks`, `CreateBookmark`, and `DeleteBookmark` operation data without persisting session credentials.
- [x] One captured `Bookmarks` request executed through `XBI_PAGE_REQUEST` returns live HTTP 200 JSON.
- [x] A complete live sync paginates the current account's bookmark backlog without partial-cache replacement or unexpected rate limiting.
- [ ] No injected card appears on Profile, Search, Bookmarks, Following, unknown layouts, or logged-out pages.
- [ ] Empty cache, login failure, sync failure, and rate limiting produce no feed status card; useful errors remain in the popup.
- [x] Exactly one Zara-faithful native bookmark post appears first on For You, with no rail/tint/chips; current-X author fields render and the full post body opens the exact bookmarked status.
- [x] Long post text clamps to six rendered lines; `Read more` expands, `Show less` collapses, and `Open on X` reaches the same exact status.
- [ ] Reloading Home chooses an eligible random item; a bookmark's rank remains stable until the next successful sync changes the ordered set.
- [ ] Rank set is contiguous `1..N`, and `#1` matches the oldest item in X's newest-saved-first Bookmarks response.
- [ ] Posted date matches the post's published date; no UI or documentation claims an exact bookmarked-at time.
- [ ] Count-left matches cached total minus successfully Done items; Keep does not decrement it.
- [ ] Keep removes the current card, leaves the X bookmark intact, and observes the local cooldown.
- [ ] Done asks for confirmation when configured, deletes from X only after a successful response, and decrements count-left.
- [ ] Undo within six seconds re-creates the X bookmark and restores local state.
- [ ] A failed delete leaves the card and local state unchanged and shows an actionable error.
- [ ] A failed, partial, malformed, or HTTP 429 sync retains the prior cache and reports a useful popup error.
- [ ] A non-empty cached backlog with every item Done and no sync error shows `Backlog cleared ✓` only on For You, then refreshes after sync or Undo state changes.
- [ ] Dark and light X themes remain readable; media and text do not overflow at narrow width; keyboard focus and reduced-motion behavior work.
- [ ] `chrome.storage.local` contains no Bearer, CSRF, cookie, replay header, operation template, or telemetry data.
- [ ] README first-run instructions work on a fresh extension profile.
