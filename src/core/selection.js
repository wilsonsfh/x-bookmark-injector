export function pickBookmark(bookmarks, cleared, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const cooldownMs = (opts.cooldownHours ?? 72) * 3600e3;
  const rng = opts.rng ?? Math.random;
  const excludeIds = opts.excludeIds instanceof Set
    ? opts.excludeIds
    : new Set(opts.excludeIds ?? []);
  const notDone = Object.values(bookmarks).filter((b) => !excludeIds.has(b.id)
    && !['done', 'reconciliation'].includes(cleared[b.id]?.action));
  const active = notDone.filter((b) => {
    const c = cleared[b.id];
    if (c?.action === 'keep') return now - new Date(c.at).getTime() >= cooldownMs;
    return true;
  });
  const pool = active.length ? active : notDone;
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}
