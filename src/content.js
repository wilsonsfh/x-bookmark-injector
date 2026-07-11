import { SEL, CARD_ID, isHome } from './selectors.js';

function buildStaticCard() {
  const el = document.createElement('div');
  el.id = CARD_ID;
  el.setAttribute('data-testid', 'cellInnerDiv');
  el.style.cssText = 'padding:12px 16px;border-bottom:1px solid #2f3336;background:linear-gradient(180deg,#0b1016,#000);color:#e7e9ea;font:15px system-ui';
  el.innerHTML = `
    <div style="color:#1d9bf0;font-weight:700;font-size:12.5px;margin-bottom:4px">📌 From your bookmarks
      <span style="color:#71767b;font-weight:500">· static preview</span></div>
    <div>Injected card placeholder — real bookmark wired in Task 10.</div>`;
  return el;
}

function findTimeline() {
  return document.querySelector(SEL.primaryColumn)?.querySelector(SEL.timeline) ?? null;
}

function pinCard() {
  if (!isHome()) { removeCard(); return; }
  const timeline = findTimeline();
  const firstCell = [...(timeline?.querySelectorAll(SEL.cell) ?? [])]
    .find((cell) => cell.id !== CARD_ID);
  if (!firstCell?.parentElement) { removeCard(); return; }

  const card = document.getElementById(CARD_ID) ?? buildStaticCard();
  if (firstCell.previousElementSibling === card) return;
  firstCell.parentElement.insertBefore(card, firstCell);
}

function removeCard() {
  document.getElementById(CARD_ID)?.remove();
}

const observer = new MutationObserver(() => pinCard());
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-selected'],
});

// SPA route changes: X uses pushState; re-evaluate on navigation.
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname !== lastPath) { lastPath = location.pathname; pinCard(); }
}, 500);

pinCard();
console.debug('[xbi] content loaded');
