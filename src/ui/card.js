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
  --xbi-target-size: 28px;
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
#${CARD_ID} .xbi-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--xbi-space-2) var(--xbi-space-3);
}
#${CARD_ID} .xbi-id-row {
  display: grid;
  grid-template-columns: var(--xbi-avatar-size) minmax(0, 1fr);
  gap: var(--xbi-space-3);
  flex: 1 1 240px;
  min-width: 0;
}
#${CARD_ID} .xbi-identity { min-width: 0; }
#${CARD_ID} .xbi-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: var(--xbi-space-1) var(--xbi-space-2);
  flex: 0 1 auto;
  margin-left: auto;
}
#${CARD_ID} .xbi-post-body-link,
#${CARD_ID} .xbi-post-body {
  display: block;
  margin-left: calc(var(--xbi-avatar-size) + var(--xbi-space-3));
  border-radius: 2px;
  color: inherit;
  text-decoration: none;
}
#${CARD_ID} .xbi-post-body-link:hover { background: color-mix(in srgb, currentColor 3%, transparent); }
#${CARD_ID} .xbi-post-body-link:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
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
#${CARD_ID} .xbi-author {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex-wrap: wrap;
}
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
#${CARD_ID} .xbi-link-card {
  display: block;
  margin: var(--xbi-space-1) 0 var(--xbi-space-3);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: var(--xbi-radius-media);
  overflow: hidden;
}
#${CARD_ID} .xbi-link-card-image {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: cover;
}
#${CARD_ID} .xbi-link-card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--xbi-space-2) var(--xbi-space-3);
}
#${CARD_ID} .xbi-link-card-domain {
  color: color-mix(in srgb, currentColor 60%, transparent);
  font-size: var(--xbi-text-label);
  overflow-wrap: anywhere;
}
#${CARD_ID} .xbi-link-card-title {
  font-weight: 600;
  overflow-wrap: anywhere;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
#${CARD_ID} .xbi-status { margin: var(--xbi-space-2) 0 0 calc(var(--xbi-avatar-size) + var(--xbi-space-3)); font-size: var(--xbi-text-sm); }
#${CARD_ID} .xbi-status[hidden] { display: none; }
#${CARD_ID} .xbi-quoted {
  margin: var(--xbi-space-1) 0 var(--xbi-space-2) calc(var(--xbi-avatar-size) + var(--xbi-space-3));
}
#${CARD_ID} .xbi-quoted[hidden] { display: none; }
#${CARD_ID} .xbi-quoted-link {
  display: block;
  padding: var(--xbi-space-2) var(--xbi-space-3);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: var(--xbi-radius-media);
  color: inherit;
  text-decoration: none;
}
#${CARD_ID} .xbi-quoted-link:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
#${CARD_ID} .xbi-quoted-link:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-quoted-head { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 2px; }
#${CARD_ID} .xbi-quoted-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}
#${CARD_ID} .xbi-quoted-media {
  display: block;
  width: 100%;
  max-height: 240px;
  margin-top: var(--xbi-space-2);
  border-radius: 12px;
  object-fit: cover;
}
#${CARD_ID} .xbi-footer { margin-left: calc(var(--xbi-avatar-size) + var(--xbi-space-3)); }
#${CARD_ID} .xbi-meta-controls { display: flex; flex-wrap: wrap; gap: var(--xbi-space-3); }
#${CARD_ID} .xbi-meta-controls:empty { display: none; }
#${CARD_ID} .xbi-expand,
#${CARD_ID} .xbi-quote-toggle,
#${CARD_ID} .xbi-reroll {
  padding: 0;
  border: 0;
  color: var(--xbi-link);
  background: transparent;
  font: inherit;
  font-size: var(--xbi-text-label);
  font-weight: 600;
  cursor: pointer;
}
#${CARD_ID} .xbi-expand,
#${CARD_ID} .xbi-quote-toggle { min-height: 28px; }
/* re-roll sits in the top action cluster beside the pills, so it matches their height */
#${CARD_ID} .xbi-reroll { min-height: var(--xbi-target-size); padding: 0 var(--xbi-space-2); font-size: var(--xbi-text-sm); font-weight: 500; }
#${CARD_ID} .xbi-expand:focus-visible,
#${CARD_ID} .xbi-quote-toggle:focus-visible,
#${CARD_ID} .xbi-reroll:focus-visible { outline: 2px solid var(--xbi-accent-text); outline-offset: 2px; }
#${CARD_ID} .xbi-reroll:disabled { opacity: .55; cursor: wait; }
#${CARD_ID} .xbi-post-link,
#${CARD_ID} .xbi-action {
  display: inline-flex;
  min-height: var(--xbi-target-size);
  align-items: center;
  justify-content: center;
  padding: 0 var(--xbi-space-2);
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  border-radius: var(--xbi-radius-pill);
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: var(--xbi-text-sm);
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

// A native-style link/article preview (title, domain, thumbnail) shown instead of
// a bare t.co shortlink. It is a non-link element, so it sits inside the body link
// without nesting an anchor and opens the bookmarked status like the rest of the body.
function buildLinkPreview(link) {
  if (!link || typeof link !== 'object') return null;
  const title = typeof link.title === 'string' ? link.title.trim() : '';
  const domain = typeof link.domain === 'string' ? link.domain.trim() : '';
  const image = trustedUrl(link.image, IMAGE_HOSTS);
  if (!title && !domain && !image) return null;

  const card = node('div', null, 'xbi-link-card');
  if (image) {
    const preview = node('img', null, 'xbi-link-card-image');
    preview.src = image;
    preview.alt = '';
    preview.loading = 'lazy';
    card.append(preview);
  }
  const body = node('div', null, 'xbi-link-card-body');
  if (domain) body.append(node('span', domain, 'xbi-link-card-domain'));
  if (title) body.append(node('span', title, 'xbi-link-card-title'));
  card.append(body);
  return card;
}

function buildQuoted(quoted) {
  if (!quoted || typeof quoted !== 'object') return null;
  const hasText = typeof quoted.text === 'string' && quoted.text.trim();
  const mediaUrl = trustedUrl(quoted.media?.[0]?.url, IMAGE_HOSTS);
  if (!hasText && !mediaUrl) return null;

  const section = node('section', null, 'xbi-quoted');
  section.id = 'xbi-quoted-content';
  section.hidden = true;
  const url = trustedUrl(quoted.url, POST_HOSTS, /^\/[^/]+\/status\/\d+\/?$/);
  const inner = node(url ? 'a' : 'div', null, 'xbi-quoted-link');
  if (url) {
    const who = quoted.handle || quoted.author || 'this account';
    inner.setAttribute('aria-label', `Open quoted post by ${who} on X (opens in new tab)`);
    inner.href = url;
    inner.target = '_blank';
    inner.rel = 'noopener noreferrer';
  }
  const head = node('div', null, 'xbi-quoted-head');
  head.append(node('strong', quoted.author || quoted.handle || 'Quoted post'));
  if (quoted.handle) head.append(node('span', quoted.handle, 'xbi-handle'));
  inner.append(head);
  if (hasText) inner.append(node('p', quoted.text, 'xbi-quoted-text'));
  if (mediaUrl) {
    const image = node('img', null, 'xbi-quoted-media');
    image.src = mediaUrl;
    image.alt = typeof quoted.media[0].alt === 'string' && quoted.media[0].alt.trim()
      ? quoted.media[0].alt
      : 'Quoted post media';
    image.loading = 'lazy';
    inner.append(image);
  }
  section.append(inner);
  return section;
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

  const identity = node('div', null, 'xbi-identity');
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
  identity.append(provenance, authorRow);

  const hasText = typeof bookmark.text === 'string' && bookmark.text.trim().length > 0;
  const text = node('p', bookmark.text, 'xbi-text');
  text.id = 'xbi-text-content';
  const isLongPost = hasText && Array.from(bookmark.text).length > 320;
  if (isLongPost) text.className = 'xbi-text xbi-text-collapsed';
  if (hasText) postBody.append(text);
  const linkPreview = buildLinkPreview(bookmark.link);
  if (linkPreview) postBody.append(linkPreview);

  const firstMedia = bookmark.media?.[0];
  const mediaUrl = trustedUrl(firstMedia?.url, IMAGE_HOSTS);
  if (mediaUrl) {
    const image = node('img', null, 'xbi-media');
    image.src = mediaUrl;
    image.alt = typeof firstMedia.alt === 'string' && firstMedia.alt.trim()
      ? firstMedia.alt
      : `Image from ${bookmark.author || bookmark.handle || 'this account'}'s bookmarked post`;
    image.loading = 'lazy';
    postBody.append(image);
  }

  const engagement = buildEngagement(bookmark.engagement);
  if (engagement) postBody.append(engagement);

  const status = node('p', null, 'xbi-status');
  status.role = 'status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const quotedSection = buildQuoted(bookmark.quoted);

  const footer = node('div', null, 'xbi-footer');
  const metaControls = node('div', null, 'xbi-meta-controls');
  footer.append(metaControls);
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
    if (metaControls.children.length > 0) metaControls.insertBefore(expand, metaControls.children[0]);
    else metaControls.append(expand);
    return expand;
  };
  if (isLongPost) ensureExpand();
  if (quotedSection) {
    const quoteToggle = node('button', 'Show quoted post', 'xbi-quote-toggle');
    quoteToggle.type = 'button';
    quoteToggle.setAttribute('aria-controls', quotedSection.id);
    quoteToggle.setAttribute('aria-expanded', 'false');
    quoteToggle.addEventListener('click', () => {
      const shown = quoteToggle.getAttribute('aria-expanded') === 'true';
      quoteToggle.setAttribute('aria-expanded', String(!shown));
      quoteToggle.textContent = shown ? 'Show quoted post' : 'Hide quoted post';
      quotedSection.hidden = shown;
    });
    metaControls.append(quoteToggle);
  }

  // Action controls live in a top-of-card cluster, in line with the provenance
  // and author rows (the header), instead of a bottom footer. They must stay
  // OUTSIDE the post-body link (no interactive nesting inside an <a>).
  const actions = node('div', null, 'xbi-actions');
  if (postUrl) {
    const link = node('a', 'Open on X ↗', 'xbi-post-link');
    link.setAttribute('aria-label', openLabel);
    link.href = postUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  const keepButton = action('Keep for later', false);
  const doneButton = action('Done · Remove', true);
  // Keep, Done, and re-roll share ONE lock: only one interaction can be in
  // flight at a time, so a re-roll cannot race a Keep/Done (or vice versa).
  const controls = [keepButton, doneButton];
  let actionPending = false;
  const runAction = async (handler, fallbackMessage) => {
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
          : fallbackMessage;
        status.hidden = false;
      }
    } catch {
      status.textContent = fallbackMessage;
      status.hidden = false;
    } finally {
      // A successful re-roll detaches this card; re-enabling its now-orphaned
      // controls is harmless, and the fresh replacement card has its own lock.
      actionPending = false;
      card.removeAttribute('aria-busy');
      controls.forEach((button) => { button.disabled = false; });
    }
  };
  const ACTION_FALLBACK = 'Could not update this bookmark. Try again.';
  keepButton.addEventListener('click', () => runAction(handlers.onKeep, ACTION_FALLBACK));
  doneButton.addEventListener('click', () => runAction(handlers.onDone, ACTION_FALLBACK));
  actions.append(keepButton, doneButton);

  if (typeof handlers.onReroll === 'function') {
    const reroll = node('button', 'Show another bookmark', 'xbi-reroll');
    reroll.type = 'button';
    controls.push(reroll);
    reroll.addEventListener('click', () => runAction(handlers.onReroll, 'No other bookmark to show right now.'));
    actions.append(reroll);
  }

  const idRow = node('div', null, 'xbi-id-row');
  idRow.append(avatarSlot, identity);
  const header = node('div', null, 'xbi-header');
  header.append(idRow, actions);

  card.append(header, status);
  if (quotedSection) card.append(postBody, quotedSection, footer);
  else card.append(postBody, footer);
  if (typeof ResizeObserver === 'function' && hasText) {
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
