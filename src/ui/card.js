import { CARD_ID } from '../selectors.js';

const CARD_CSS = `
#${CARD_ID} {
  --xbi-accent: #1d9bf0;
  --xbi-accent-text: currentColor;
  --xbi-on-accent: #0f1419;
  --xbi-space-1: 4px;
  --xbi-space-2: 8px;
  --xbi-space-3: 12px;
  --xbi-space-4: 16px;
  --xbi-text-sm: 12px;
  --xbi-text-label: 13px;
  --xbi-text-base: 15px;
  --xbi-avatar-size: 40px;
  --xbi-target-size: 36px;
  --xbi-media-max-height: 360px;
  --xbi-radius-sm: 10px;
  --xbi-radius-media: 14px;
  --xbi-radius-pill: 999px;
  --xbi-duration-fast: 160ms;
  box-sizing: border-box;
  padding: var(--xbi-space-3) var(--xbi-space-4);
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-left: 3px solid var(--xbi-accent);
  color: inherit;
  background: color-mix(in srgb, var(--xbi-accent) 5%, transparent);
  font: var(--xbi-text-base)/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}
#${CARD_ID}, #${CARD_ID} * { box-sizing: border-box; }
#${CARD_ID} .xbi-header,
#${CARD_ID} .xbi-author,
#${CARD_ID} .xbi-actions {
  display: flex;
  align-items: center;
  gap: var(--xbi-space-2);
}
#${CARD_ID} .xbi-header { justify-content: space-between; margin-bottom: var(--xbi-space-2); }
#${CARD_ID} .xbi-label { color: var(--xbi-accent-text); font-size: var(--xbi-text-label); font-weight: 700; }
#${CARD_ID} .xbi-chips { display: flex; flex-wrap: wrap; gap: var(--xbi-space-2); margin-bottom: var(--xbi-space-3); }
#${CARD_ID} .xbi-chip {
  max-width: 100%;
  padding: var(--xbi-space-1) var(--xbi-space-2);
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: var(--xbi-radius-pill);
  font-size: var(--xbi-text-sm);
  overflow-wrap: anywhere;
}
#${CARD_ID} .xbi-chip-accent { border-color: var(--xbi-accent); color: var(--xbi-accent-text); }
#${CARD_ID} .xbi-author { min-width: 0; margin-bottom: var(--xbi-space-2); }
#${CARD_ID} .xbi-avatar {
  width: var(--xbi-avatar-size);
  height: var(--xbi-avatar-size);
  flex: 0 0 var(--xbi-avatar-size);
  border-radius: 50%;
  object-fit: cover;
}
#${CARD_ID} .xbi-identity { min-width: 0; overflow-wrap: anywhere; }
#${CARD_ID} .xbi-handle { opacity: .62; }
#${CARD_ID} .xbi-text { margin: 0 0 var(--xbi-space-2); white-space: pre-wrap; overflow-wrap: anywhere; }
#${CARD_ID} .xbi-media {
  display: block;
  width: 100%;
  max-height: var(--xbi-media-max-height);
  margin: var(--xbi-space-1) 0 var(--xbi-space-3);
  border-radius: var(--xbi-radius-media);
  object-fit: cover;
}
#${CARD_ID} .xbi-actions { margin-top: var(--xbi-space-3); }
#${CARD_ID} .xbi-status { margin: var(--xbi-space-2) 0 0; font-size: var(--xbi-text-sm); }
#${CARD_ID} .xbi-status[hidden] { display: none; }
#${CARD_ID} .xbi-post-link {
  display: inline-flex;
  min-height: var(--xbi-target-size);
  align-items: center;
  color: var(--xbi-accent-text);
  font-weight: 700;
}
#${CARD_ID} .xbi-post-link:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-action {
  min-width: 0;
  min-height: var(--xbi-target-size);
  flex: 1;
  padding: var(--xbi-space-2) var(--xbi-space-3);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: var(--xbi-radius-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 700;
  line-height: 1.2;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: background-color var(--xbi-duration-fast) ease-out, border-color var(--xbi-duration-fast) ease-out;
}
#${CARD_ID} .xbi-action:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
#${CARD_ID} .xbi-action:active { background: color-mix(in srgb, currentColor 14%, transparent); }
#${CARD_ID} .xbi-action:disabled { opacity: .55; cursor: wait; }
#${CARD_ID} .xbi-action-primary {
  border-color: var(--xbi-accent);
  color: var(--xbi-on-accent);
  background: var(--xbi-accent);
}
#${CARD_ID} .xbi-action-primary:hover { background: color-mix(in srgb, var(--xbi-accent) 88%, currentColor); }
#${CARD_ID} .xbi-action:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-action-primary:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 3px var(--xbi-on-accent);
}
@media (max-width: 420px) {
  #${CARD_ID} .xbi-actions { align-items: stretch; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  #${CARD_ID} .xbi-action { transition: none; }
}
@media (forced-colors: active) {
  #${CARD_ID} .xbi-action-primary:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
    box-shadow: none;
  }
}`;

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
}

const POST_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']);
const IMAGE_HOSTS = new Set(['pbs.twimg.com', 'abs.twimg.com', 'ton.twimg.com', 'video.twimg.com']);

function trustedUrl(value, hosts, pathPattern) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname.toLowerCase())) return null;
    if (pathPattern && !pathPattern.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function formatCardMeta(bookmark, total, left) {
  const postedAt = bookmark.createdAt ? new Date(bookmark.createdAt) : null;
  const posted = postedAt && !Number.isNaN(postedAt.getTime())
    ? `Posted ${new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(postedAt)}`
    : 'Posted time unavailable';
  return {
    rank: `Saved #${bookmark.saveRank} of ${total} · ${ordinal(bookmark.saveRank)} oldest`,
    posted,
    left: `${left} left`,
  };
}

function node(tag, text, className = '') {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function chip(text, accent = false) {
  return node('span', text, `xbi-chip${accent ? ' xbi-chip-accent' : ''}`);
}

function action(label, primary) {
  const button = node('button', label, `xbi-action${primary ? ' xbi-action-primary' : ''}`);
  button.type = 'button';
  return button;
}

export function buildCardElement(bookmark, stats, handlers) {
  const meta = formatCardMeta(bookmark, stats.total, stats.left);
  const card = node('article');
  card.id = CARD_ID;
  card.dataset.testid = 'cellInnerDiv';
  card.setAttribute('aria-label', 'Bookmark resurfaced');
  card.append(node('style', CARD_CSS));

  const header = node('header', null, 'xbi-header');
  header.append(node('strong', '📌 From your bookmarks', 'xbi-label'), chip(meta.left, true));
  card.append(header);

  const chips = node('div', null, 'xbi-chips');
  chips.append(chip(meta.rank, true), chip(meta.posted));
  card.append(chips);

  const authorRow = node('div', null, 'xbi-author');
  const avatarUrl = trustedUrl(bookmark.avatar, IMAGE_HOSTS);
  if (avatarUrl) {
    const avatar = node('img', null, 'xbi-avatar');
    avatar.src = avatarUrl;
    avatar.alt = '';
    avatar.width = 40;
    avatar.height = 40;
    authorRow.append(avatar);
  }
  const identity = node('div', null, 'xbi-identity');
  identity.append(node('strong', bookmark.author || bookmark.handle || 'Unknown author'));
  if (bookmark.handle) identity.append(node('span', ` ${bookmark.handle}`, 'xbi-handle'));
  authorRow.append(identity);
  card.append(authorRow, node('p', bookmark.text, 'xbi-text'));

  const firstMedia = bookmark.media?.[0];
  const mediaUrl = trustedUrl(firstMedia?.url, IMAGE_HOSTS);
  if (mediaUrl) {
    const image = node('img', null, 'xbi-media');
    image.src = mediaUrl;
    image.alt = typeof firstMedia.alt === 'string' && firstMedia.alt.trim()
      ? firstMedia.alt
      : `Image from ${bookmark.author || bookmark.handle || 'this account'}'s bookmarked post`;
    image.loading = 'lazy';
    card.append(image);
  }

  const postUrl = trustedUrl(bookmark.url, POST_HOSTS, /^\/[^/]+\/status\/\d+\/?$/);
  if (postUrl) {
    const link = node('a', 'View post on X', 'xbi-post-link');
    link.href = postUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    card.append(link);
  }

  const status = node('p', null, 'xbi-status');
  status.role = 'status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  card.append(status);

  const buttons = node('div', null, 'xbi-actions');
  const keepButton = action('Keep for later', false);
  const doneButton = action('Done ✓ Remove from X', true);
  const controls = [keepButton, doneButton];
  let actionPending = false;
  const runAction = async (handler) => {
    if (actionPending) return;
    actionPending = true;
    card.setAttribute('aria-busy', 'true');
    status.hidden = true;
    status.textContent = '';
    controls.forEach((button) => { button.disabled = true; });
    try {
      const result = await handler();
      if (result?.ok !== true && result?.cancelled !== true) {
        status.textContent = result?.ok === false && typeof result.error === 'string'
          ? result.error
          : 'Could not update this bookmark. Try again.';
        status.hidden = false;
      }
    } catch {
      status.textContent = 'Could not update this bookmark. Try again.';
      status.hidden = false;
    } finally {
      actionPending = false;
      card.removeAttribute('aria-busy');
      controls.forEach((button) => { button.disabled = false; });
    }
  };
  keepButton.addEventListener('click', () => runAction(handlers.onKeep));
  doneButton.addEventListener('click', () => runAction(handlers.onDone));
  buttons.append(keepButton, doneButton);
  card.append(buttons);
  return card;
}
