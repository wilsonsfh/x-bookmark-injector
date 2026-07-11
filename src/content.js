import { countLeft } from './core/count.js';
import { pickBookmark } from './core/selection.js';
import {
  EXT_SOURCE,
  mergeAuth,
  PAGE_SOURCE,
  sanitizeCapture,
  validateExecutionResult,
  validatePageRequest,
} from './bridge.js';
import { CARD_ID, SEL, isHome } from './selectors.js';
import { loadState } from './storage.js';
import { buildCardElement, buildStatusCard } from './ui/card.js';

let latestAuth = {
  bearer: null,
  csrf: null,
  queryIds: {},
  operationHeaders: {},
  operationTemplates: {},
};
const pendingPageRequests = new Map();

// Static source labels route messages; they do not authenticate page-world senders.
window.addEventListener('message', (event) => {
  const message = event.data;
  if (event.source !== window || message?.source !== PAGE_SOURCE) return;

  if (message.type === 'XBI_AUTH_CAPTURE') {
    const capture = sanitizeCapture(message.capture);
    if (!capture) return;
    latestAuth = mergeAuth(latestAuth, capture);
    try {
      void chrome.runtime.sendMessage({ type: 'XBI_AUTH_CAPTURE', capture }).catch(() => {});
    } catch {
      // The service worker may be unavailable while the page is unloading.
    }
    return;
  }

  if (message.type === 'XBI_EXECUTE_RESULT' && typeof message.requestId === 'string') {
    const pending = pendingPageRequests.get(message.requestId);
    if (pending && validateExecutionResult(message, pending.operation)) {
      pendingPageRequests.delete(message.requestId);
      pending.resolve(message);
    }
  }
});

function executeInPage(request, operation) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPageRequests.delete(requestId);
      resolve({ ok: false, status: 0, error: 'Page request timed out' });
    }, 20_000);
    pendingPageRequests.set(requestId, {
      operation,
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
    });
    try {
      window.postMessage({ source: EXT_SOURCE, type: 'XBI_EXECUTE', requestId, request }, '*');
    } catch {
      clearTimeout(timeout);
      pendingPageRequests.delete(requestId);
      resolve({ ok: false, status: 0, error: 'Page request failed' });
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'XBI_GET_PAGE_AUTH') {
    sendResponse(latestAuth);
    return false;
  }
  if (message?.type === 'XBI_PAGE_REQUEST') {
    const request = validatePageRequest(message.request);
    if (!request) {
      sendResponse({ ok: false, status: 0, error: 'Invalid page request' });
      return false;
    }
    executeInPage(message.request, request.operation).then(sendResponse);
    return true;
  }
  return false;
});

let loadInFlight = false;
let visitCompleted = false;
let homeVisit = 0;
let currentCard = null;
let visitModel = null;
let lastPath = location.pathname;
let mutationFramePending = false;
let stateLoadInFlight = null;

function loadSharedState() {
  if (!stateLoadInFlight) {
    const pending = loadState();
    stateLoadInFlight = pending;
    const clearPending = () => {
      if (stateLoadInFlight === pending) stateLoadInFlight = null;
    };
    pending.then(clearPending, clearPending);
  }
  return stateLoadInFlight;
}

function findTimeline() {
  return document.querySelector(SEL.primaryColumn)?.querySelector(SEL.timeline) ?? null;
}

function firstTimelineCell() {
  const timeline = findTimeline();
  return [...(timeline?.querySelectorAll(SEL.cell) ?? [])]
    .find((cell) => cell.id !== CARD_ID) ?? null;
}

function removeCard() {
  currentCard?.remove();
  document.getElementById(CARD_ID)?.remove();
}

function positionCard() {
  const firstCell = firstTimelineCell();
  if (!firstCell?.parentElement || !currentCard) return false;
  if (firstCell.previousElementSibling !== currentCard) {
    firstCell.parentElement.insertBefore(currentCard, firstCell);
  }
  return true;
}

function focusFeed() {
  const target = firstTimelineCell();
  if (!target) return;
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function showUndoToast(tweetId, undoUntil, reconciliationPending = false) {
  const existing = document.getElementById('xbi-undo');
  if (existing?.dataset.tweetId === tweetId
    && Number(existing.dataset.undoUntil) === undoUntil
    && existing.dataset.reconciliationPending === String(reconciliationPending)) return;
  existing?.remove();
  const toast = document.createElement('div');
  toast.id = 'xbi-undo';
  toast.dataset.tweetId = tweetId;
  toast.dataset.undoUntil = String(undoUntil);
  toast.dataset.reconciliationPending = String(reconciliationPending);
  toast.role = 'status';
  toast.setAttribute('aria-live', 'polite');
  toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#1d9bf0;color:white;padding:10px 14px;border-radius:999px;font:700 14px system-ui;box-shadow:0 8px 30px #0008';
  toast.append(reconciliationPending
    ? 'Delete outcome uncertain · Undo safely restores · '
    : 'Bookmark removed from X · ');
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'Undo';
  undo.style.cssText = 'border:0;background:transparent;color:white;text-decoration:underline;font:inherit;cursor:pointer';
  let undoPending = false;
  let settled = false;
  undo.addEventListener('click', async () => {
    if (undoPending) return;
    undoPending = true;
    undo.disabled = true;
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action: 'undo', tweetId });
    } catch {
      result = null;
    }
    if (result?.ok === true) {
      settled = true;
      toast.textContent = 'Bookmark restored';
      focusFeed();
    } else {
      toast.textContent = result?.ok === false && typeof result.error === 'string'
        ? result.error
        : 'Undo failed';
    }
    setTimeout(() => toast.remove(), 1_200);
  });
  toast.append(undo);
  document.body.append(toast);
  undo.focus();
  setTimeout(() => {
    if (settled) return;
    settled = true;
    toast.remove();
    focusFeed();
  }, Math.max(0, undoUntil - Date.now()));
}

async function recoverPendingUndo() {
  if (!isHome()) return;
  try {
    const state = await chrome.runtime.sendMessage({ type: 'XBI_GET_STATE' });
    const recovered = Object.entries(
      state?.pendingUndo && typeof state.pendingUndo === 'object' ? state.pendingUndo : {},
    ).find(([, record]) => Number.isFinite(record?.undoUntil) && record.undoUntil > Date.now());
    if (recovered) showUndoToast(
      recovered[0],
      recovered[1].undoUntil,
      recovered[1].reconciliationPending === true,
    );
  } catch {
    // The next Home visit can retry without disturbing the feed.
  }
}

async function maybeSync() {
  if (!isHome()) return;
  try {
    const state = await loadSharedState();
    const lastSync = state.meta.lastSync === null
      ? 0
      : new Date(state.meta.lastSync).getTime();
    const hours = state.settings.syncEveryHours;
    if (!Number.isFinite(lastSync) || !Number.isFinite(hours) || hours <= 0) return;
    const age = lastSync === 0 ? Infinity : Date.now() - lastSync;
    if (age >= hours * 3_600_000 && state.meta.syncStatus !== 'syncing') {
      await chrome.runtime.sendMessage({ type: 'XBI_SYNC' });
    }
  } catch {
    // A future navigation or storage update can retry without disrupting the card.
  }
}

async function pinRandomCard() {
  if (!isHome()) { removeCard(); return; }
  if (!firstTimelineCell()?.parentElement) { removeCard(); return; }
  if (currentCard) { positionCard(); return; }
  if (loadInFlight || visitCompleted) return;
  loadInFlight = true;
  const visit = homeVisit;

  try {
    if (!visitModel) {
      const state = await loadSharedState();
      if (visit !== homeVisit) return;
      const bookmark = pickBookmark(state.bookmarks, state.cleared, {
        cooldownHours: state.settings.keepCooldownHours,
      });
      if (!bookmark) {
        if (Object.keys(state.bookmarks).length > 0
          && countLeft(state.bookmarks, state.cleared) === 0
          && state.meta.syncStatus !== 'error'
          && state.meta.syncError == null) {
          currentCard = buildStatusCard(
            'Backlog cleared ✓',
            'No saved bookmarks left to resurface.',
          );
          if (isHome()) positionCard();
        }
        visitCompleted = true;
        return;
      }
      visitModel = {
        bookmark,
        settings: state.settings,
        stats: {
          total: Object.keys(state.bookmarks).length,
          left: countLeft(state.bookmarks, state.cleared),
        },
      };
    }
    const { bookmark, settings, stats } = visitModel;

    let card;
    const dismiss = () => {
      if (currentCard !== card || homeVisit !== visit) return;
      card.remove();
      currentCard = null;
    };
    const runAction = async (action) => {
      const result = await chrome.runtime.sendMessage({
        type: 'XBI_ACTION',
        action,
        tweetId: bookmark.id,
      });
      const validSuccess = result?.ok === true
        && (action !== 'done'
          || (Number.isFinite(result.undoUntil) && result.undoUntil > Date.now()));
      if (!validSuccess) {
        return result?.ok === false && typeof result.error === 'string'
          ? result
          : { ok: false };
      }
      dismiss();
      if (action === 'done') {
        showUndoToast(bookmark.id, result.undoUntil, result.reconciliationPending === true);
      }
      return result;
    };
    card = buildCardElement(
      bookmark,
      stats,
      {
        onKeep: () => runAction('keep'),
        onDone: async () => {
          if (settings.confirmRealDelete && !settings.deleteConfirmed) {
            const approved = window.confirm('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
            if (!approved) return { cancelled: true };
          }
          return runAction('done');
        },
      },
    );
    currentCard = card;
    visitCompleted = true;

    if (isHome()) positionCard();
  } catch (error) {
    if (visit === homeVisit) console.warn('[xbi] unable to render bookmark card', error);
  } finally {
    if (visit === homeVisit) loadInFlight = false;
  }
}

function schedulePin() {
  if (mutationFramePending) return;
  mutationFramePending = true;
  requestAnimationFrame(() => {
    mutationFramePending = false;
    void pinRandomCard();
  });
}

const observer = new MutationObserver(schedulePin);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-selected'],
});

setInterval(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    homeVisit += 1;
    removeCard();
    currentCard = null;
    visitModel = null;
    stateLoadInFlight = null;
    loadInFlight = false;
    visitCompleted = false;
    void pinRandomCard();
    void recoverPendingUndo();
  }
}, 500);

void pinRandomCard();
void recoverPendingUndo();
chrome.storage.onChanged.addListener((changes, area) => {
  const stateChanged = changes.bookmarks || changes.cleared || changes.meta;
  if (area === 'local'
    && stateChanged
    && currentCard?.dataset.xbiKind === 'completion-status') {
    removeCard();
    currentCard = null;
    visitModel = null;
    stateLoadInFlight = null;
    visitCompleted = false;
    void pinRandomCard();
    return;
  }
  if (area === 'local' && changes.bookmarks && !visitModel) {
    visitCompleted = false;
    void pinRandomCard();
  }
});
void maybeSync();
console.debug('[xbi] content loaded');
