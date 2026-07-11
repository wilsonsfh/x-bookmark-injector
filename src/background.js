import { mergeAuth, sanitizeCapture } from './bridge.js';
import { mergeBookmarks } from './core/merge.js';
import { normalizeTweet } from './core/normalize.js';
import { assignSaveRank } from './core/ranking.js';
import { loadState, savePatch } from './storage.js';
import { collectBookmarkPages } from './sync.js';
import { OPERATIONS } from './x-api/constants.js';
import {
  buildBookmarksRequest,
  buildMutationRequest,
  parseBookmarks,
} from './x-api/graphql.js';

const PERSISTED_OPERATIONS = Object.values(OPERATIONS);
const PENDING_UNDO_KEY = 'pendingUndo';
const UNCERTAIN_MUTATION_STATUSES = new Set([0, 408, 409, 425, 429]);

let sessionAuth = {
  bearer: null,
  csrf: null,
  queryIds: {},
  operationHeaders: {},
  operationTemplates: {},
};
let persistQueue = Promise.resolve();
let actionStateQueue = Promise.resolve();
let syncInFlight = null;
const pendingUndo = new Map();
const undoExpiryTimers = new Map();
const actionsInFlight = new Map();

async function persistPendingUndo() {
  const records = Object.fromEntries(pendingUndo);
  if (Object.keys(records).length === 0) {
    await chrome.storage.session?.remove(PENDING_UNDO_KEY);
    return;
  }
  await chrome.storage.session?.set({ [PENDING_UNDO_KEY]: records });
}

function scheduleUndoExpiry(tweetId, record) {
  clearTimeout(undoExpiryTimers.get(tweetId)?.timer);
  const timer = setTimeout(() => {
    const current = pendingUndo.get(tweetId);
    if (current?.undoUntil !== record.undoUntil || current?.requestedAt !== record.requestedAt) return;
    pendingUndo.delete(tweetId);
    undoExpiryTimers.delete(tweetId);
    void persistPendingUndo().catch(() => {});
    void clearPendingAction(tweetId, record.requestedAt);
  }, Math.max(0, record.undoUntil - Date.now()));
  undoExpiryTimers.set(tweetId, { timer, requestedAt: record.requestedAt });
}

function pendingUndoProjection() {
  return Object.fromEntries([...pendingUndo.entries()]
    .filter(([, record]) => Number.isFinite(record.undoUntil) && record.undoUntil > Date.now())
    .map(([tweetId, record]) => [tweetId, {
      undoUntil: record.undoUntil,
      recovery: record.recovery === true,
      reconciliationPending: record.reconciliationPending === true,
    }]));
}

async function restorePendingUndo() {
  const stored = await chrome.storage.session?.get(PENDING_UNDO_KEY);
  const records = stored?.[PENDING_UNDO_KEY];
  if (records && typeof records === 'object' && !Array.isArray(records)) {
    for (const [tweetId, record] of Object.entries(records)) {
      if (record && ((Number.isFinite(record.undoUntil) && record.undoUntil > Date.now())
        || (record.recovery === true && record.bookmark && typeof record.bookmark === 'object'))) {
        pendingUndo.set(tweetId, record);
      }
    }
  }

  const state = await loadState();
  const pendingActions = { ...state.pendingActions };
  const cleared = { ...state.cleared };
  const bookmarks = { ...state.bookmarks };
  let localChanged = false;
  for (const [tweetId, record] of pendingUndo) {
    if (state.pendingActions[tweetId]?.requestedAt !== record.requestedAt) {
      pendingUndo.delete(tweetId);
    }
  }
  for (const [tweetId, intent] of Object.entries(state.pendingActions)) {
    if (intent?.action !== 'delete' || !intent.bookmark || typeof intent.bookmark !== 'object') continue;
    let record = pendingUndo.get(tweetId);
    const recordIsValid = Number.isFinite(record?.undoUntil) && record.undoUntil > Date.now();
    if (!recordIsValid
      && ['deleted', 'reconciliation'].includes(intent.phase)
      && intent.undoUntil > Date.now()) {
      record = {
        undoUntil: intent.undoUntil,
        bookmark: intent.bookmark,
        requestedAt: intent.requestedAt,
        reconciliationPending: intent.reconciliationPending === true,
      };
      pendingUndo.set(tweetId, record);
    }
    if (record && record.requestedAt !== intent.requestedAt) {
      record = { ...record, requestedAt: intent.requestedAt };
      pendingUndo.set(tweetId, record);
    }
    const recoveredRecordIsValid = Number.isFinite(record?.undoUntil) && record.undoUntil > Date.now();
    if (intent.phase === 'prepared'
      || (intent.phase === 'deleted' && !recoveredRecordIsValid && intent.recovery === true)) {
      if (!Number.isFinite(record?.undoUntil) || record.undoUntil <= Date.now()) {
        record = {
          undoUntil: Date.now() + 6_000,
          bookmark: intent.bookmark,
          requestedAt: intent.requestedAt,
          reconciliationPending: true,
        };
      }
      pendingUndo.set(tweetId, record);
      pendingActions[tweetId] = {
        ...intent,
        phase: 'reconciliation',
        undoUntil: record.undoUntil,
      };
      bookmarks[tweetId] = intent.bookmark;
      cleared[tweetId] = {
        action: intent.phase === 'deleted' ? 'done' : 'reconciliation',
        at: intent.requestedAt,
        ...(intent.phase === 'deleted' ? { reconciliation: true } : {}),
      };
      localChanged = true;
    } else if (intent.phase === 'reconciliation' && !recoveredRecordIsValid) {
      pendingUndo.delete(tweetId);
      delete pendingActions[tweetId];
      localChanged = true;
    } else if (!recoveredRecordIsValid && intent.phase === 'deleted') {
      pendingUndo.delete(tweetId);
      delete pendingActions[tweetId];
      localChanged = true;
    }
  }
  try {
    await persistPendingUndo();
  } catch {
    // Local intent tokens remain authoritative while session storage is unavailable.
  }
  if (localChanged) await savePatch({ bookmarks, cleared, pendingActions });
  for (const [tweetId, record] of pendingUndo) {
    if (Number.isFinite(record.undoUntil) && record.undoUntil > Date.now()) {
      scheduleUndoExpiry(tweetId, record);
    }
  }
}

const pendingUndoReady = restorePendingUndo();

async function loadProjectedState() {
  await pendingUndoReady;
  return {
    ...await loadState(),
    pendingUndo: pendingUndoProjection(),
  };
}

async function xTab(sender) {
  if (Number.isInteger(sender.tab?.id)) return sender.tab;
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: ['https://x.com/*', 'https://twitter.com/*'],
  });
  if (!Number.isInteger(tab?.id)) throw new Error('Open x.com in the active tab');
  return tab;
}

async function authFor(tabId) {
  const [state, pageAuth] = await Promise.all([
    loadState(),
    chrome.tabs.sendMessage(tabId, { type: 'XBI_GET_PAGE_AUTH' }),
  ]);
  if (!pageAuth || typeof pageAuth !== 'object') throw new Error('X session auth not captured; reload x.com');
  sessionAuth = {
    bearer: pageAuth.bearer ?? sessionAuth.bearer,
    csrf: pageAuth.csrf ?? sessionAuth.csrf,
    queryIds: { ...state.auth.queryIds, ...sessionAuth.queryIds, ...(pageAuth.queryIds ?? {}) },
    operationHeaders: { ...sessionAuth.operationHeaders, ...(pageAuth.operationHeaders ?? {}) },
    operationTemplates: { ...sessionAuth.operationTemplates, ...(pageAuth.operationTemplates ?? {}) },
  };
  if (!sessionAuth.bearer || !sessionAuth.csrf) throw new Error('X session auth not captured; reload x.com');
  return sessionAuth;
}

async function pageRequest(tabId, request) {
  const response = await chrome.tabs.sendMessage(tabId, { type: 'XBI_PAGE_REQUEST', request });
  if (!response || typeof response !== 'object') throw new Error('X request failed');
  const validStatus = Number.isInteger(response.status) && response.status >= 200 && response.status < 300;
  if (response.ok !== true || !validStatus) {
    const error = new Error(typeof response.error === 'string' ? response.error : 'X request failed');
    error.status = Number.isInteger(response.status) ? response.status : 0;
    throw error;
  }
  if (!response.payload || typeof response.payload !== 'object') throw new Error('X response invalid');
  return response.payload;
}

async function invalidateBookmarksQueryId() {
  const latest = await loadState();
  const queryIds = { ...latest.auth.queryIds };
  delete queryIds[OPERATIONS.BOOKMARKS];
  const memoryQueryIds = { ...sessionAuth.queryIds };
  delete memoryQueryIds[OPERATIONS.BOOKMARKS];
  sessionAuth = { ...sessionAuth, queryIds: memoryQueryIds };
  await savePatch({ auth: { queryIds } });
}

function syncBookmarks(tabId) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      await pendingUndoReady;
      const prior = await loadState();
      await savePatch({
        meta: {
          ...prior.meta,
          syncStatus: 'syncing',
          syncError: null,
          syncStartedAt: new Date().toISOString(),
        },
      });
      const auth = await authFor(tabId);
      const raw = await collectBookmarkPages(async (cursor) => {
        const payload = await pageRequest(tabId, buildBookmarksRequest(auth, cursor));
        return parseBookmarks(payload);
      });
      const seenIds = new Set();
      const normalized = raw.map(normalizeTweet).filter((bookmark) => {
        if (!bookmark) throw new Error('X bookmarks integration response invalid');
        if (seenIds.has(bookmark.id)) return false;
        seenIds.add(bookmark.id);
        return true;
      });
      const ranked = assignSaveRank(normalized);
      const bookmarks = mergeBookmarks(prior.bookmarks, ranked);
      await savePatch({
        bookmarks,
        meta: {
          ...prior.meta,
          total: ranked.length,
          lastSync: new Date().toISOString(),
          syncStatus: 'idle',
          syncError: null,
          syncStartedAt: null,
        },
      });
      return { ok: true, total: ranked.length };
    } catch (error) {
      if (error.status === 404) await invalidateBookmarksQueryId();
      const latest = await loadState();
      await savePatch({
        meta: {
          ...latest.meta,
          syncStatus: 'error',
          syncStartedAt: null,
          syncError: error.status === 429
            ? 'Rate limited by X; try later'
            : error.status === 404
              ? 'Bookmarks request changed. Open X Bookmarks to recapture, then sync again.'
            : String(error.message ?? error),
        },
      });
      return { ok: false, error: String(error.message ?? error), status: error.status ?? 0 };
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

function mutationSucceeded(operation, payload) {
  const successField = operation === OPERATIONS.DELETE
    ? 'tweet_bookmark_delete'
    : operation === OPERATIONS.CREATE
      ? 'tweet_bookmark_put'
      : null;
  return successField !== null
    && payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (payload.errors === undefined
      || (Array.isArray(payload.errors) && payload.errors.length === 0))
    && payload.data
    && typeof payload.data === 'object'
    && !Array.isArray(payload.data)
    && payload.data[successField] === 'Done';
}

function updateActionState(createPatch) {
  const update = actionStateQueue
    .catch(() => {})
    .then(async () => {
      const state = await loadState();
      const patch = createPatch(state);
      if (patch) await savePatch(patch);
    });
  actionStateQueue = update;
  return update;
}

function updateSettings(patch) {
  if (!patch
    || typeof patch !== 'object'
    || Array.isArray(patch)
    || Object.keys(patch).length !== 1
    || typeof patch.confirmRealDelete !== 'boolean') {
    return Promise.resolve({ ok: false, error: 'Invalid settings patch' });
  }
  return updateActionState((state) => ({
    settings: { ...state.settings, confirmRealDelete: patch.confirmRealDelete },
  })).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error: String(error.message ?? error) }),
  );
}

function clearPendingAction(tweetId, expectedRequestedAt) {
  return updateActionState((state) => {
    if (expectedRequestedAt !== undefined
      && state.pendingActions[tweetId]?.requestedAt !== expectedRequestedAt) return null;
    const pendingActions = { ...state.pendingActions };
    delete pendingActions[tweetId];
    return { pendingActions };
  });
}

async function retainReconciliation(tweetId, intent) {
  const record = {
    undoUntil: Date.now() + 6_000,
    bookmark: intent.bookmark,
    requestedAt: intent.requestedAt,
    recovery: true,
    reconciliationPending: true,
  };
  pendingUndo.set(tweetId, record);
  await persistPendingUndo();
  try {
    await updateActionState((state) => {
      if (state.pendingActions[tweetId]?.requestedAt !== intent.requestedAt) return null;
      return {
        bookmarks: { ...state.bookmarks, [tweetId]: intent.bookmark },
        cleared: {
          ...state.cleared,
          [tweetId]: { action: 'reconciliation', at: intent.requestedAt },
        },
        pendingActions: {
          ...state.pendingActions,
          [tweetId]: {
            ...intent,
            phase: 'reconciliation',
            undoUntil: record.undoUntil,
            reconciliationPending: record.reconciliationPending === true,
          },
        },
      };
    });
  } catch {
    // The prepared intent remains durable and startup recovery can project this record.
  }
  scheduleUndoExpiry(tweetId, record);
  return record;
}

function isDefiniteMutationRejection(status) {
  return Number.isInteger(status)
    && status >= 400
    && status < 500
    && !UNCERTAIN_MUTATION_STATUSES.has(status);
}

async function act(message, sender) {
  await pendingUndoReady;
  const at = new Date().toISOString();
  let deleteIntent;
  if (message.action === 'keep') {
    await updateActionState((state) => {
      if (state.cleared[message.tweetId]?.action === 'done') {
        throw new Error('Bookmark is already Done');
      }
      return {
        cleared: { ...state.cleared, [message.tweetId]: { action: 'keep', at } },
      };
    });
    return { ok: true };
  }

  if (message.action === 'undo') {
    if ((pendingUndo.get(message.tweetId)?.undoUntil ?? 0) <= Date.now()) {
      return { ok: false, error: 'Undo window expired' };
    }
  }

  if (message.action === 'done') {
    await updateActionState((state) => {
      const bookmark = state.bookmarks[message.tweetId];
      if (!bookmark || typeof bookmark !== 'object') throw new Error('Bookmark is not cached');
      deleteIntent = {
        action: 'delete',
        phase: 'prepared',
        requestedAt: at,
        bookmark,
      };
      return {
        pendingActions: {
          ...state.pendingActions,
          [message.tweetId]: deleteIntent,
        },
      };
    });
  }

  const operation = message.action === 'done' ? OPERATIONS.DELETE : OPERATIONS.CREATE;
  let tab;
  let request;
  try {
    tab = await xTab(sender);
    const auth = await authFor(tab.id);
    request = buildMutationRequest(operation, auth, message.tweetId);
  } catch (error) {
    if (message.action === 'done') await clearPendingAction(message.tweetId, deleteIntent.requestedAt);
    throw error;
  }
  let payload;
  try {
    payload = await pageRequest(tab.id, request);
  } catch (error) {
    if (message.action === 'done' && isDefiniteMutationRejection(error.status)) {
      await clearPendingAction(message.tweetId, deleteIntent.requestedAt);
    } else if (message.action === 'done') {
      const record = await retainReconciliation(message.tweetId, deleteIntent);
      return {
        ok: true,
        recovery: true,
        reconciliationPending: true,
        undoUntil: record.undoUntil,
        warning: 'Delete outcome uncertain; Undo safely restores the bookmark',
      };
    }
    throw error;
  }
  if (!mutationSucceeded(operation, payload)) {
    if (message.action === 'done') {
      const record = await retainReconciliation(message.tweetId, deleteIntent);
      return {
        ok: true,
        recovery: true,
        reconciliationPending: true,
        undoUntil: record.undoUntil,
        warning: 'Delete outcome uncertain; Undo safely restores the bookmark',
      };
    }
    throw new Error('X mutation response invalid');
  }

  if (message.action === 'done') {
    pendingUndo.set(message.tweetId, {
      recovery: true,
      bookmark: deleteIntent.bookmark,
      requestedAt: deleteIntent.requestedAt,
    });
    try {
      await persistPendingUndo();
    } catch {
      const record = {
        undoUntil: Date.now() + 6_000,
        bookmark: deleteIntent.bookmark,
        requestedAt: deleteIntent.requestedAt,
        recovery: true,
      };
      pendingUndo.set(message.tweetId, record);
      await updateActionState((state) => ({
        bookmarks: { ...state.bookmarks, [message.tweetId]: deleteIntent.bookmark },
        cleared: {
          ...state.cleared,
          [message.tweetId]: { action: 'done', at, reconciliation: true },
        },
        settings: { ...state.settings, deleteConfirmed: true },
        pendingActions: {
          ...state.pendingActions,
          [message.tweetId]: {
            ...deleteIntent,
            phase: 'reconciliation',
            undoUntil: record.undoUntil,
          },
        },
      }));
      scheduleUndoExpiry(message.tweetId, record);
      return {
        ok: true,
        recovery: true,
        undoUntil: record.undoUntil,
        warning: 'Bookmark removed; session recovery persisted locally',
      };
    }
    try {
      await updateActionState((state) => ({
        cleared: { ...state.cleared, [message.tweetId]: { action: 'done', at } },
        settings: { ...state.settings, deleteConfirmed: true },
        pendingActions: {
          ...state.pendingActions,
          [message.tweetId]: {
            ...deleteIntent,
            phase: 'deleted',
            recovery: true,
          },
        },
      }));
    } catch (error) {
      const undoUntil = Date.now() + 6_000;
      pendingUndo.set(message.tweetId, {
        undoUntil,
        bookmark: deleteIntent.bookmark,
        requestedAt: deleteIntent.requestedAt,
      });
      await persistPendingUndo();
      scheduleUndoExpiry(message.tweetId, pendingUndo.get(message.tweetId));
      return {
        ok: true,
        recovery: true,
        undoUntil,
        warning: 'Bookmark removed; local state recovery pending',
      };
    }
    const undoUntil = Date.now() + 6_000;
    pendingUndo.set(message.tweetId, {
      undoUntil,
      bookmark: deleteIntent.bookmark,
      requestedAt: deleteIntent.requestedAt,
    });
    await persistPendingUndo();
    await updateActionState((state) => ({
      pendingActions: {
        ...state.pendingActions,
        [message.tweetId]: {
          ...state.pendingActions[message.tweetId],
          recovery: false,
          undoUntil,
        },
      },
    }));
    scheduleUndoExpiry(message.tweetId, pendingUndo.get(message.tweetId));
    return { ok: true, undoUntil };
  }

  const undoRecord = pendingUndo.get(message.tweetId);
  await updateActionState((state) => {
    const cleared = { ...state.cleared };
    const pendingActions = { ...state.pendingActions };
    delete cleared[message.tweetId];
    delete pendingActions[message.tweetId];
    return {
      bookmarks: undoRecord?.bookmark
        ? { ...state.bookmarks, [message.tweetId]: undoRecord.bookmark }
        : state.bookmarks,
      cleared,
      pendingActions,
    };
  });
  clearTimeout(undoExpiryTimers.get(message.tweetId)?.timer);
  undoExpiryTimers.delete(message.tweetId);
  pendingUndo.delete(message.tweetId);
  try {
    await persistPendingUndo();
  } catch {
    // Local restore already committed; stale session data is ignored by token checks on wake.
  }
  return { ok: true };
}

function validAction(message) {
  return ['keep', 'done', 'undo'].includes(message.action)
    && typeof message.tweetId === 'string'
    && Boolean(message.tweetId.trim());
}

function runAction(message, sender) {
  if (!validAction(message)) return Promise.resolve({ ok: false, error: 'Invalid bookmark action' });
  const current = actionsInFlight.get(message.tweetId);
  if (current?.action === message.action) return current.promise;

  const execute = async () => {
    try {
      return await act(message, sender);
    } catch (error) {
      return {
        ok: false,
        error: String(error.message ?? error),
        status: error.status ?? 0,
      };
    }
  };
  const promise = current ? current.promise.then(execute) : execute();
  const entry = { action: message.action, promise };
  actionsInFlight.set(message.tweetId, entry);
  promise.finally(() => {
    if (actionsInFlight.get(message.tweetId) === entry) actionsInFlight.delete(message.tweetId);
  });
  return promise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'XBI_AUTH_CAPTURE') {
    const capture = sanitizeCapture(message.capture);
    if (!capture) return false;

    const queryIdChanged = sessionAuth.queryIds[capture.operation] !== capture.queryId;
    sessionAuth = mergeAuth(sessionAuth, capture);
    if (!queryIdChanged) {
      sendResponse({ ok: true });
      return false;
    }
    const queryIds = Object.fromEntries(PERSISTED_OPERATIONS
      .filter((operation) => sessionAuth.queryIds[operation])
      .map((operation) => [operation, sessionAuth.queryIds[operation]]));
    persistQueue = persistQueue
      .catch(() => {})
      .then(() => savePatch({ auth: { queryIds } }));
    persistQueue.then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'Unable to persist query IDs' }),
    );
    return true;
  }

  if (message?.type === 'XBI_GET_SESSION_AUTH') {
    sendResponse(sessionAuth);
    return false;
  }
  if (message?.type === 'XBI_SYNC') {
    xTab(_sender)
      .then((tab) => syncBookmarks(tab.id))
      .then(sendResponse, (error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }
  if (message?.type === 'XBI_ACTION') {
    runAction(message, _sender).then(sendResponse);
    return true;
  }
  if (message?.type === 'XBI_UPDATE_SETTINGS') {
    updateSettings(message.patch).then(sendResponse);
    return true;
  }
  if (message?.type === 'XBI_GET_STATE') {
    loadProjectedState()
      .then(sendResponse, (error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }
  return false;
});
