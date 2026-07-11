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
    auth: { queryIds: { ...(raw.auth?.queryIds ?? {}) } },
    settings: { ...DEFAULT_STATE.settings, ...(raw.settings ?? {}) },
  };
}

export async function loadState() {
  return applyDefaults(await chrome.storage.local.get(null));
}

export async function savePatch(patch) {
  await chrome.storage.local.set(patch);
}
