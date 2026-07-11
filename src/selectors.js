// Centralized so DOM drift is fixed in one place (spec §12).
export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  selectedTab: '[role="tab"][aria-selected="true"]',
  timeline: '[aria-label^="Timeline"]',
  cell: '[data-testid="cellInnerDiv"]',
};
export const CARD_ID = 'xbi-card';
export function isForYouLabel(label) {
  return typeof label === 'string' && label.trim().toLowerCase() === 'for you';
}

export function isHome() {
  if (location.pathname !== '/home') return false;
  const primaryColumn = document.querySelector(SEL.primaryColumn);
  const selectedTab = primaryColumn?.querySelector(SEL.selectedTab);
  return isForYouLabel(selectedTab?.textContent);
}
