import { countLeft } from './core/count.js';
import { pickBookmark } from './core/selection.js';
import { CARD_ID, SEL, isHome } from './selectors.js';
import { loadState } from './storage.js';
import { buildCardElement } from './ui/card.js';

let handledThisHomeVisit = false;
let homeVisit = 0;
let currentCard = null;
let lastPath = location.pathname;

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
  if (handledThisHomeVisit) return;
  handledThisHomeVisit = true;
  const visit = homeVisit;

  const state = await loadState();
  if (visit !== homeVisit) return;
  const bookmark = pickBookmark(state.bookmarks, state.cleared, {
    cooldownHours: state.settings.keepCooldownHours,
  });
  if (!bookmark) return;

  const dismiss = () => {
    removeCard();
    currentCard = null;
  };
  const runAction = async (action) => {
    const result = await chrome.runtime.sendMessage({
      type: 'XBI_ACTION',
      action,
      tweetId: bookmark.id,
    });
    if (result?.ok) dismiss();
  };
  currentCard = buildCardElement(
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
        await runAction('done');
      },
    },
  );

  if (isHome()) positionCard();
}

const observer = new MutationObserver(() => void pinRandomCard());
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
    handledThisHomeVisit = false;
    void pinRandomCard();
  }
}, 500);

void pinRandomCard();
console.debug('[xbi] content loaded');
