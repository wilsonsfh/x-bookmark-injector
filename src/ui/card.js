import { CARD_ID } from '../selectors.js';

const CARD_CSS = `
#${CARD_ID} {
  --xbi-accent: #1d9bf0;
  --xbi-accent-text: currentColor;
  --xbi-link: color-mix(in srgb, var(--xbi-accent) 65%, currentColor);
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
  --xbi-radius-media: 14px;
  --xbi-radius-pill: 999px;
  --xbi-duration-fast: 120ms;
  box-sizing: border-box;
  padding: var(--xbi-space-3) var(--xbi-space-4);
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  color: inherit;
  background: transparent;
  font: var(--xbi-text-base)/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
#${CARD_ID}, #${CARD_ID} * { box-sizing: border-box; }
#${CARD_ID} .xbi-post-body-link,
#${CARD_ID} .xbi-post-body {
  display: grid;
  grid-template-columns: var(--xbi-avatar-size) minmax(0, 1fr);
  gap: var(--xbi-space-3);
  border-radius: 2px;
  color: inherit;
  text-decoration: none;
}
#${CARD_ID} .xbi-post-body-link:hover { background: color-mix(in srgb, currentColor 3%, transparent); }
#${CARD_ID} .xbi-post-body-link:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-main { min-width: 0; }
#${CARD_ID} .xbi-avatar-slot { grid-column: 1; }
#${CARD_ID} .xbi-avatar-fallback {
  display: grid;
  width: var(--xbi-avatar-size);
  height: var(--xbi-avatar-size);
  place-items: center;
  border-radius: 50%;
  color: var(--xbi-accent-text);
  background: color-mix(in srgb, currentColor 10%, transparent);
  font-weight: 700;
}
#${CARD_ID} .xbi-provenance {
  margin: 0 0 var(--xbi-space-1);
  color: color-mix(in srgb, currentColor 66%, transparent);
  font-size: var(--xbi-text-label);
  overflow-wrap: anywhere;
}
#${CARD_ID} .xbi-author,
#${CARD_ID} .xbi-utility {
  display: flex;
  align-items: center;
  gap: var(--xbi-space-2);
}
#${CARD_ID} .xbi-author { min-width: 0; flex-wrap: wrap; gap: 5px; }
#${CARD_ID} .xbi-avatar {
  width: var(--xbi-avatar-size);
  height: var(--xbi-avatar-size);
  display: block;
  border-radius: 50%;
  object-fit: cover;
}
#${CARD_ID} .xbi-handle,
#${CARD_ID} .xbi-posted,
#${CARD_ID} .xbi-separator { color: color-mix(in srgb, currentColor 58%, transparent); }
#${CARD_ID} .xbi-text { margin: var(--xbi-space-1) 0 var(--xbi-space-2); white-space: pre-wrap; overflow-wrap: anywhere; }
#${CARD_ID} .xbi-text-collapsed {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}
#${CARD_ID} .xbi-engagement {
  display: flex;
  flex-wrap: wrap;
  gap: var(--xbi-space-2) var(--xbi-space-4);
  margin: var(--xbi-space-2) 0;
  color: color-mix(in srgb, currentColor 65%, transparent);
  font-size: var(--xbi-text-label);
}
#${CARD_ID} .xbi-engagement-item { white-space: nowrap; }
#${CARD_ID} .xbi-media {
  display: block;
  width: 100%;
  max-height: var(--xbi-media-max-height);
  margin: var(--xbi-space-1) 0 var(--xbi-space-3);
  border-radius: var(--xbi-radius-media);
  object-fit: cover;
}
#${CARD_ID} .xbi-status { margin: var(--xbi-space-2) 0 0; font-size: var(--xbi-text-sm); }
#${CARD_ID} .xbi-status[hidden] { display: none; }
#${CARD_ID} .xbi-footer { margin-left: calc(var(--xbi-avatar-size) + var(--xbi-space-3)); }
#${CARD_ID} .xbi-expand {
  min-height: 28px;
  padding: 0;
  border: 0;
  color: var(--xbi-link);
  background: transparent;
  font: inherit;
  font-size: var(--xbi-text-label);
  font-weight: 600;
  cursor: pointer;
}
#${CARD_ID} .xbi-expand:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-utility {
  flex-wrap: wrap;
  margin-top: var(--xbi-space-2);
}
#${CARD_ID} .xbi-post-link,
#${CARD_ID} .xbi-action {
  display: inline-flex;
  min-height: var(--xbi-target-size);
  align-items: center;
  justify-content: center;
  padding: 0 var(--xbi-space-3);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: var(--xbi-radius-pill);
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: var(--xbi-text-label);
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--xbi-duration-fast) ease-out, transform 100ms ease-out;
}
#${CARD_ID} .xbi-post-link { border-color: var(--xbi-accent); color: var(--xbi-link); }
#${CARD_ID} .xbi-post-link:hover,
#${CARD_ID} .xbi-action:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
#${CARD_ID} .xbi-post-link:active,
#${CARD_ID} .xbi-action:active {
  background: color-mix(in srgb, currentColor 14%, transparent);
  transform: scale(.98);
}
#${CARD_ID} .xbi-action:disabled { opacity: .55; cursor: wait; }
#${CARD_ID} .xbi-action-primary {
  border-color: var(--xbi-accent);
  color: var(--xbi-on-accent);
  background: var(--xbi-accent);
}
#${CARD_ID} .xbi-action-primary:hover { background: color-mix(in srgb, var(--xbi-accent) 88%, currentColor); }
#${CARD_ID} .xbi-post-link:focus-visible,
#${CARD_ID} .xbi-action:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-action-primary:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 3px var(--xbi-on-accent);
}
@media (prefers-reduced-motion: reduce) {
  #${CARD_ID} .xbi-post-link,
  #${CARD_ID} .xbi-action { transition: none; }
}
@media (forced-colors: active) {
  #${CARD_ID} .xbi-action-primary:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
    box-shadow: none;
  }
}`;

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

export function formatCardMeta(bookmark, left) {
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

export function buildStatusCard(title, detail) {
  const card = node('article');
  const detailElement = node('div', detail);
  card.id = CARD_ID;
  card.dataset.xbiKind = 'completion-status';
  card.style.cssText = 'padding:14px 16px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent);color:inherit;background:transparent;font:15px/1.4 system-ui';
  detailElement.style.cssText = 'opacity:.7;margin-top:3px';
  card.append(node('strong', title), detailElement);
  return card;
}

function action(label, primary) {
  const button = node('button', label, `xbi-action${primary ? ' xbi-action-primary' : ''}`);
  button.type = 'button';
  return button;
}

const ENGAGEMENT_METRICS = [
  ['replies', 'Replies'],
  ['reposts', 'Reposts'],
  ['likes', 'Likes'],
  ['views', 'Views'],
  ['bookmarks', 'Bookmarks'],
];

function buildEngagement(engagement) {
  if (!engagement || typeof engagement !== 'object' || Array.isArray(engagement)) return null;
  const row = node('div', null, 'xbi-engagement');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const full = new Intl.NumberFormat('en-US');
  for (const [key, label] of ENGAGEMENT_METRICS) {
    const count = engagement[key];
    if (!Number.isSafeInteger(count) || count < 0) continue;
    const metric = node('span', `${label} ${compact.format(count)}`, 'xbi-engagement-item');
    metric.setAttribute('aria-label', `${full.format(count)} ${label.toLowerCase()}`);
    row.append(metric);
  }
  return row.children.length > 0 ? row : null;
}

export function buildCardElement(bookmark, stats, handlers) {
  const meta = formatCardMeta(bookmark, stats.left);
  const card = node('article');
  card.id = CARD_ID;
  card.dataset.testid = 'cellInnerDiv';
  card.setAttribute('aria-label', 'Bookmark resurfaced');
  card.append(node('style', CARD_CSS));

  const postUrl = trustedUrl(bookmark.url, POST_HOSTS, /^\/[^/]+\/status\/\d+\/?$/);
  const pathHandle = postUrl ? `@${new URL(postUrl).pathname.split('/')[1]}` : '';
  const postAuthor = bookmark.handle || pathHandle || bookmark.author || 'this account';
  const readLabel = `Read ${postAuthor}’s post on X (opens in new tab)`;
  const openLabel = `Open ${postAuthor}’s post on X (opens in new tab)`;
  const postBody = node(postUrl ? 'a' : 'div', null, postUrl ? 'xbi-post-body-link' : 'xbi-post-body');
  if (postUrl) {
    postBody.setAttribute('aria-label', readLabel);
    postBody.href = postUrl;
    postBody.target = '_blank';
    postBody.rel = 'noopener noreferrer';
  }

  const avatarSlot = node('div', null, 'xbi-avatar-slot');
  const avatarUrl = trustedUrl(bookmark.avatar, IMAGE_HOSTS);
  if (avatarUrl) {
    const avatar = node('img', null, 'xbi-avatar');
    avatar.src = avatarUrl;
    avatar.alt = '';
    avatar.width = 40;
    avatar.height = 40;
    avatarSlot.append(avatar);
  } else {
    const fallback = node('span', (bookmark.author || bookmark.handle || '?').trim().charAt(0).toUpperCase(), 'xbi-avatar-fallback');
    fallback.setAttribute('aria-hidden', 'true');
    avatarSlot.append(fallback);
  }

  const main = node('div', null, 'xbi-main');
  const provenance = node(
    'div',
    `📌 From your bookmarks · #${bookmark.saveRank} of ${stats.total} · ${meta.left}`,
    'xbi-provenance',
  );
  const authorRow = node('div', null, 'xbi-author');
  authorRow.append(node('strong', bookmark.author || bookmark.handle || 'Unknown author'));
  if (bookmark.handle) authorRow.append(node('span', bookmark.handle, 'xbi-handle'));
  authorRow.append(node('span', '·', 'xbi-separator'));
  authorRow.append(node(
    'span',
    meta.posted.startsWith('Posted ') ? meta.posted.slice(7) : meta.posted,
    'xbi-posted',
  ));
  const text = node('p', bookmark.text, 'xbi-text');
  text.id = 'xbi-text-content';
  const isLongPost = typeof bookmark.text === 'string' && Array.from(bookmark.text).length > 320;
  if (isLongPost) text.className = 'xbi-text xbi-text-collapsed';
  main.append(provenance, authorRow, text);

  const firstMedia = bookmark.media?.[0];
  const mediaUrl = trustedUrl(firstMedia?.url, IMAGE_HOSTS);
  if (mediaUrl) {
    const image = node('img', null, 'xbi-media');
    image.src = mediaUrl;
    image.alt = typeof firstMedia.alt === 'string' && firstMedia.alt.trim()
      ? firstMedia.alt
      : `Image from ${bookmark.author || bookmark.handle || 'this account'}'s bookmarked post`;
    image.loading = 'lazy';
    main.append(image);
  }

  const engagement = buildEngagement(bookmark.engagement);
  if (engagement) main.append(engagement);

  const status = node('p', null, 'xbi-status');
  status.role = 'status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const footer = node('div', null, 'xbi-footer');
  let expand = null;
  const ensureExpand = () => {
    if (expand) return expand;
    expand = node('button', 'Read more', 'xbi-expand');
    expand.type = 'button';
    expand.setAttribute('aria-controls', text.id);
    expand.setAttribute('aria-expanded', 'false');
    expand.addEventListener('click', () => {
      const expanded = expand.getAttribute('aria-expanded') === 'true';
      expand.setAttribute('aria-expanded', String(!expanded));
      expand.textContent = expanded ? 'Read more' : 'Show less';
      text.className = expanded ? 'xbi-text xbi-text-collapsed' : 'xbi-text';
    });
    if (footer.children.length > 0) footer.insertBefore(expand, footer.children[0]);
    else footer.append(expand);
    return expand;
  };
  if (isLongPost) ensureExpand();
  const utility = node('div', null, 'xbi-utility');
  if (postUrl) {
    const link = node('a', 'Open on X ↗', 'xbi-post-link');
    link.setAttribute('aria-label', openLabel);
    link.href = postUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    utility.append(link);
  }
  const keepButton = action('Keep for later', false);
  const doneButton = action('Done · Remove', true);
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
  utility.append(keepButton, doneButton);
  postBody.append(avatarSlot, main);
  footer.append(status, utility);
  card.append(postBody, footer);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!card.isConnected || expand?.getAttribute('aria-expanded') === 'true') return;
      text.className = 'xbi-text xbi-text-collapsed';
      const overflows = text.scrollHeight > text.clientHeight + 1;
      text.className = overflows ? 'xbi-text xbi-text-collapsed' : 'xbi-text';
      if (overflows) ensureExpand().hidden = false;
      else if (expand) expand.hidden = true;
      observer.disconnect();
    });
    observer.observe(text);
  }
  return card;
}
