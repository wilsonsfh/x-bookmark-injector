export function normalizeTweet(raw) {
  const id = raw?.rest_id ?? raw?.legacy?.id_str ?? null;
  if (!id) return null;

  const legacy = raw.legacy ?? {};
  const user = raw?.core?.user_results?.result?.legacy ?? {};
  const handle = user.screen_name ?? '';
  const media = (legacy.extended_entities?.media ?? legacy.entities?.media ?? [])
    .map((item) => ({
      type: item.type,
      url: item.media_url_https ?? item.media_url ?? '',
      alt: item.ext_alt_text ?? '',
    }));

  return {
    id,
    url: handle ? `https://x.com/${handle}/status/${id}` : null,
    text: legacy.full_text ?? legacy.text ?? '',
    author: user.name ?? '',
    handle: handle ? `@${handle}` : '',
    avatar: user.profile_image_url_https ?? '',
    createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    media,
  };
}
