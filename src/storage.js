export const SYNC_TIMEOUT_MS = 5 * 60_000;

export const DEFAULT_STATE = Object.freeze({
  bookmarks: {},
  cleared: {},
  pendingActions: {},
  meta: {
    total: 0,
    lastSync: null,
    syncStatus: 'idle',
    syncError: null,
    syncStartedAt: null,
  },
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
    pendingActions: { ...DEFAULT_STATE.pendingActions, ...(raw.pendingActions ?? {}) },
    meta: { ...DEFAULT_STATE.meta, ...(raw.meta ?? {}) },
    auth: { queryIds: { ...(raw.auth?.queryIds ?? {}) } },
    settings: { ...DEFAULT_STATE.settings, ...(raw.settings ?? {}) },
  };
}

export function recoverStaleSync(state, now = Date.now()) {
  if (state.meta.syncStatus !== 'syncing') return state;
  const startedAt = Date.parse(state.meta.syncStartedAt);
  const age = now - startedAt;
  if (Number.isFinite(startedAt) && age >= 0 && age < SYNC_TIMEOUT_MS) return state;
  return {
    ...state,
    meta: {
      ...state.meta,
      syncStatus: 'idle',
      syncStartedAt: null,
    },
  };
}

export async function loadState() {
  return recoverStaleSync(applyDefaults(await chrome.storage.local.get(null)));
}

export async function savePatch(patch) {
  await chrome.storage.local.set(patch);
}
