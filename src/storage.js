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
    // On-Home staleness backstop. Its main job is catching bookmarks added or
    // removed on OTHER devices (e.g. mobile), which the desktop add/remove
    // detector cannot see; same-device changes are captured immediately by auto-sync.
    syncEveryHours: 12,
  },
});

export function applyDefaults(raw = {}) {
  return {
    bookmarks: { ...DEFAULT_STATE.bookmarks, ...(raw.bookmarks ?? {}) },
    cleared: { ...DEFAULT_STATE.cleared, ...(raw.cleared ?? {}) },
    pendingActions: { ...DEFAULT_STATE.pendingActions, ...(raw.pendingActions ?? {}) },
    meta: { ...DEFAULT_STATE.meta, ...(raw.meta ?? {}) },
    auth: { queryIds: { ...(raw.auth?.queryIds ?? {}) } },
    settings: {
      confirmRealDelete: raw.settings?.confirmRealDelete ?? DEFAULT_STATE.settings.confirmRealDelete,
      deleteConfirmed: raw.settings?.deleteConfirmed ?? DEFAULT_STATE.settings.deleteConfirmed,
      keepCooldownHours: raw.settings?.keepCooldownHours ?? DEFAULT_STATE.settings.keepCooldownHours,
      syncEveryHours: raw.settings?.syncEveryHours ?? DEFAULT_STATE.settings.syncEveryHours,
    },
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
  const raw = await chrome.storage.local.get(null);
  const state = recoverStaleSync(applyDefaults(raw));
  if (raw.settings && Object.hasOwn(raw.settings, 'cardStyle')) {
    await chrome.storage.local.set({ settings: state.settings });
  }
  return state;
}

export async function savePatch(patch) {
  await chrome.storage.local.set(patch);
}
