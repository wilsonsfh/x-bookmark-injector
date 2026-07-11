import { countLeft } from './core/count.js';
import { pickBookmark } from './core/selection.js';
import {
  EXT_SOURCE,
  mergeAuth,
  PAGE_SOURCE,
  sanitizeCapture,
} from './bridge.js';
import { CARD_ID, SEL, isHome } from './selectors.js';
import { loadState } from './storage.js';
import { buildCardElement } from './ui/card.js';

let latestAuth = {
  bearer: null,
  csrf: null,
  queryIds: {},
  operationHeaders: {},
  operationTemplates: {},
};
const pendingPageRequests = new Map();

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
    if (pending) {
      pendingPageRequests.delete(message.requestId);
      pending(message);
    }
  }
});

function executeInPage(request) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPageRequests.delete(requestId);
      resolve({ ok: false, status: 0, error: 'Page request timed out' });
    }, 20_000);
    pendingPageRequests.set(requestId, (result) => {
      clearTimeout(timeout);
      resolve(result);
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
    executeInPage(message.request).then(sendResponse);
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

async function pinRandomCard() {
  if (!isHome()) { removeCard(); return; }
  if (!firstTimelineCell()?.parentElement) { removeCard(); return; }
  if (currentCard) { positionCard(); return; }
  if (loadInFlight || visitCompleted) return;
  loadInFlight = true;
  const visit = homeVisit;

  try {
    if (!visitModel) {
      const state = await loadState();
      if (visit !== homeVisit) return;
      const bookmark = pickBookmark(state.bookmarks, state.cleared, {
        cooldownHours: state.settings.keepCooldownHours,
      });
      if (!bookmark) {
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
      if (result?.ok === true) dismiss();
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
    loadInFlight = false;
    visitCompleted = false;
    void pinRandomCard();
  }
}, 500);

void pinRandomCard();
console.debug('[xbi] content loaded');
