export function mergeBookmarks(existing, incoming, now = new Date().toISOString()) {
  const merged = {};
  for (const b of incoming) {
    merged[b.id] = { ...(existing[b.id] ?? {}), ...b, fetchedAt: now };
  }
  return merged;
}
