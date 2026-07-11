function safeCount(value) {
  const count = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function normalizeTweet(raw) {
  const rawId = raw?.rest_id ?? raw?.legacy?.id_str;
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id) return null;

  const legacy = raw.legacy ?? {};
  const userResult = raw?.core?.user_results?.result ?? {};
  const userLegacy = userResult.legacy ?? {};
  const userCore = userResult.core ?? {};
  const handle = userLegacy.screen_name ?? userCore.screen_name ?? userResult.screen_name ?? '';
  const author = userLegacy.name ?? userCore.name ?? userResult.name ?? '';
  const avatar = userLegacy.profile_image_url_https
    ?? userResult.avatar?.image_url
    ?? userResult.profile_image_url_https
    ?? '';
  const media = (legacy.extended_entities?.media ?? legacy.entities?.media ?? [])
    .map((item) => ({
      type: item.type,
      url: item.media_url_https ?? item.media_url ?? '',
      alt: item.ext_alt_text ?? '',
    }))
    .filter((item) => typeof item.url === 'string' && Boolean(item.url.trim()));
  const rawText = raw?.note_tweet?.note_tweet_results?.result?.text
    ?? legacy.full_text
    ?? legacy.text
    ?? '';
  const text = typeof rawText === 'string' ? rawText : '';
  if (!text.trim() && media.length === 0) return null;
  const engagement = Object.fromEntries(Object.entries({
    replies: safeCount(legacy.reply_count),
    reposts: safeCount(legacy.retweet_count),
    likes: safeCount(legacy.favorite_count),
    views: safeCount(raw?.views?.count),
    bookmarks: safeCount(legacy.bookmark_count),
  }).filter(([, count]) => count !== null));

  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : null,
    text,
    author,
    handle: handle ? `@${handle}` : '',
    avatar,
    createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    media,
    ...(Object.keys(engagement).length > 0 ? { engagement } : {}),
  };
}
