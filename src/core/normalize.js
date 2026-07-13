function safeCount(value) {
  const count = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function extractUser(raw) {
  const userResult = raw?.core?.user_results?.result ?? {};
  const userLegacy = userResult.legacy ?? {};
  const userCore = userResult.core ?? {};
  return {
    handle: userLegacy.screen_name ?? userCore.screen_name ?? userResult.screen_name ?? '',
    author: userLegacy.name ?? userCore.name ?? userResult.name ?? '',
    avatar: userLegacy.profile_image_url_https
      ?? userResult.avatar?.image_url
      ?? userResult.profile_image_url_https
      ?? '',
  };
}

function extractMedia(legacy) {
  return (legacy.extended_entities?.media ?? legacy.entities?.media ?? [])
    .map((item) => ({
      type: item.type,
      url: item.media_url_https ?? item.media_url ?? '',
      alt: item.ext_alt_text ?? '',
    }))
    .filter((item) => typeof item.url === 'string' && Boolean(item.url.trim()));
}

function extractText(raw, legacy) {
  const rawText = raw?.note_tweet?.note_tweet_results?.result?.text
    ?? legacy.full_text
    ?? legacy.text
    ?? '';
  return typeof rawText === 'string' ? rawText : '';
}

// Turns X's t.co shortlinks into the readable display URL, removes media
// self-links and the link-card's own shortlink, and preserves paragraph breaks.
function cleanText(text, legacy, cardUrl) {
  if (typeof text !== 'string' || !text) return '';
  const urls = Array.isArray(legacy?.entities?.urls) ? legacy.entities.urls : [];
  const stripped = new Set(
    (legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [])
      .map((item) => item?.url)
      .filter((url) => typeof url === 'string' && url),
  );
  if (typeof cardUrl === 'string' && cardUrl) stripped.add(cardUrl);

  let cleaned = text;
  for (const entry of urls) {
    if (!entry || typeof entry.url !== 'string' || !entry.url) continue;
    const replacement = stripped.has(entry.url)
      ? ''
      : (typeof entry.display_url === 'string' && entry.display_url ? entry.display_url : '');
    cleaned = cleaned.split(entry.url).join(replacement);
  }
  for (const url of stripped) cleaned = cleaned.split(url).join('');

  return cleaned
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bindingValue(values, key) {
  const entry = values.find((item) => item?.key === key);
  const value = entry?.value;
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.string_value === 'string') return value.string_value;
  if (value.image_value && typeof value.image_value.url === 'string') return value.image_value.url;
  return undefined;
}

function extractCard(card) {
  const values = Array.isArray(card?.legacy?.binding_values) ? card.legacy.binding_values : null;
  if (!values) return null;
  const title = bindingValue(values, 'title');
  const domain = bindingValue(values, 'vanity_url') ?? bindingValue(values, 'domain');
  const image = bindingValue(values, 'thumbnail_image_large')
    ?? bindingValue(values, 'thumbnail_image')
    ?? bindingValue(values, 'summary_photo_image_large')
    ?? bindingValue(values, 'photo_image_full_size_large')
    ?? bindingValue(values, 'player_image_large');
  const url = typeof card.legacy.url === 'string' ? card.legacy.url : bindingValue(values, 'card_url');
  if (!title && !image) return null;
  return { title, domain, image, url };
}

function extractArticle(raw) {
  const result = raw?.article?.article_results?.result;
  if (!result || typeof result !== 'object') return null;
  const title = typeof result.title === 'string' ? result.title : undefined;
  const info = result.cover_media_results?.result?.media_info ?? result.cover_media?.media_info;
  const image = typeof info?.original_img_url === 'string'
    ? info.original_img_url
    : (typeof info?.media_url_https === 'string' ? info.media_url_https : undefined);
  if (!title && !image) return null;
  return { title, domain: undefined, image, url: undefined };
}

// Isolated: a malformed card/article subtree must never discard the bookmark.
function extractLink(raw) {
  try {
    const card = extractCard(raw?.card);
    const article = extractArticle(raw);
    if (!card && !article) return null;
    const title = card?.title ?? article?.title;
    const domain = card?.domain ?? article?.domain;
    const image = card?.image ?? article?.image;
    const url = card?.url ?? article?.url;
    if (!title && !image) return { preview: null, url };
    return {
      preview: {
        ...(title ? { title } : {}),
        ...(domain ? { domain } : {}),
        ...(image ? { image } : {}),
      },
      url,
    };
  } catch {
    return null;
  }
}

// Normalizes a single post; never recurses into a nested quote, so it is safe to
// reuse for both the bookmarked post and its one quoted post.
function extractPost(raw) {
  const rawId = raw?.rest_id ?? raw?.legacy?.id_str;
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) return null;

  const legacy = raw.legacy ?? {};
  const { handle, author, avatar } = extractUser(raw);
  const media = extractMedia(legacy);
  const link = extractLink(raw);
  const text = cleanText(extractText(raw, legacy), legacy, link?.url);
  if (!text.trim() && media.length === 0 && !link?.preview) return null;

  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : null,
    text,
    author,
    handle: handle ? `@${handle}` : '',
    avatar,
    createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    media,
    ...(link?.preview ? { link: link.preview } : {}),
  };
}

// Isolated from the outer post: a malformed quoted subtree (e.g. an unparseable
// timestamp) must never discard the otherwise-valid bookmark that quotes it.
function extractQuoted(raw) {
  try {
    const quotedRaw = raw?.quoted_status_result?.result
      ?? raw?.legacy?.retweeted_status_result?.result;
    const inner = quotedRaw?.tweet ?? quotedRaw;
    if (!inner) return null;
    return extractPost(inner);
  } catch {
    return null;
  }
}

export function normalizeTweet(raw) {
  const post = extractPost(raw);
  if (!post) return null;

  const legacy = raw.legacy ?? {};
  const engagement = Object.fromEntries(Object.entries({
    replies: safeCount(legacy.reply_count),
    reposts: safeCount(legacy.retweet_count),
    likes: safeCount(legacy.favorite_count),
    views: safeCount(raw?.views?.count),
    bookmarks: safeCount(legacy.bookmark_count),
  }).filter(([, count]) => count !== null));
  const quoted = extractQuoted(raw);

  return {
    ...post,
    ...(Object.keys(engagement).length > 0 ? { engagement } : {}),
    ...(quoted ? { quoted } : {}),
  };
}
