import { countLeft } from './core/count.js';
import { pickBookmark } from './core/selection.js';
import { CARD_ID, SEL, isHome } from './selectors.js';
import { loadState } from './storage.js';
import { buildCardElement } from './ui/card.js';

let loadInFlight = false;
let visitCompleted = false;
let homeVisit = 0;
let currentCard = null;
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
    const state = await loadState();
    if (visit !== homeVisit) return;
    const bookmark = pickBookmark(state.bookmarks, state.cleared, {
      cooldownHours: state.settings.keepCooldownHours,
    });
    if (!bookmark) {
      visitCompleted = true;
      return;
    }

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
      if (result?.ok) dismiss();
      return result;
    };
    card = buildCardElement(
      bookmark,
      {
        total: Object.keys(state.bookmarks).length,
        left: countLeft(state.bookmarks, state.cleared),
      },
      {
        onKeep: () => runAction('keep'),
        onDone: async () => {
          if (state.settings.confirmRealDelete && !state.settings.deleteConfirmed) {
            const approved = window.confirm('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
            if (!approved) return;
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
    loadInFlight = false;
    visitCompleted = false;
    void pinRandomCard();
  }
}, 500);

void pinRandomCard();
console.debug('[xbi] content loaded');
