// Centralized so DOM drift is fixed in one place (spec §12).
export const SEL = {
  primaryColumn: '[data-testid="primaryColumn"]',
  timeline: '[aria-label^="Timeline"]',
  cell: '[data-testid="cellInnerDiv"]',
};
export const CARD_ID = 'xbi-card';
export function isHome() {
  return location.pathname === '/home';
}
