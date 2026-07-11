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
const actionsInFlight = new Map();

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

function syncBookmarks(tabId) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      const prior = await loadState();
      await savePatch({ meta: { ...prior.meta, syncStatus: 'syncing', syncError: null } });
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
        },
      });
      return { ok: true, total: ranked.length };
    } catch (error) {
      const latest = await loadState();
      await savePatch({
        meta: {
          ...latest.meta,
          syncStatus: 'error',
          syncError: error.status === 429
            ? 'Rate limited by X; try later'
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
      await savePatch(createPatch(state));
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

async function act(message, sender) {
  const at = new Date().toISOString();
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

  if (message.action === 'undo' && (pendingUndo.get(message.tweetId) ?? 0) <= Date.now()) {
    return { ok: false, error: 'Undo window expired' };
  }

  const tab = await xTab(sender);
  const auth = await authFor(tab.id);
  const operation = message.action === 'done' ? OPERATIONS.DELETE : OPERATIONS.CREATE;
  const payload = await pageRequest(tab.id, buildMutationRequest(operation, auth, message.tweetId));
  if (!mutationSucceeded(operation, payload)) throw new Error('X mutation response invalid');

  if (message.action === 'done') {
    await updateActionState((state) => ({
      cleared: { ...state.cleared, [message.tweetId]: { action: 'done', at } },
      settings: { ...state.settings, deleteConfirmed: true },
    }));
    const undoUntil = Date.now() + 6_000;
    pendingUndo.set(message.tweetId, undoUntil);
    setTimeout(() => {
      if (pendingUndo.get(message.tweetId) === undoUntil) pendingUndo.delete(message.tweetId);
    }, 6_100);
    return { ok: true, undoUntil };
  }

  await updateActionState((state) => {
    const cleared = { ...state.cleared };
    delete cleared[message.tweetId];
    return { cleared };
  });
  pendingUndo.delete(message.tweetId);
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
    loadState().then(sendResponse, (error) => sendResponse({ ok: false, error: String(error.message ?? error) }));
    return true;
  }
  return false;
});
