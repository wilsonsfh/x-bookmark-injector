const sleepFor = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

async function fetchWithBackoff(fetchPage, cursor, sleep) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchPage(cursor);
    } catch (error) {
      if (error?.status !== 429 || attempt === 2) throw error;
      await sleep(250 * (2 ** attempt));
    }
  }
  throw new Error('Rate-limit retry exhausted');
}

export async function collectBookmarkPages(fetchPage, { maxPages = 100, sleep = sleepFor } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error('maxPages must be an integer from 1 to 100');
  }
  const tweets = [];
  const seenCursors = new Set();
  let cursor = null;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchWithBackoff(fetchPage, cursor, sleep);
    if (!result || !Array.isArray(result.tweets)
      || (result.nextCursor !== null && typeof result.nextCursor !== 'string')) {
      throw new Error('Bookmark pagination response invalid');
    }
    tweets.push(...result.tweets);
    if (!result.nextCursor) return tweets;
    if (seenCursors.has(result.nextCursor)) {
      throw new Error('Bookmark pagination cursor repeated');
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  throw new Error('Bookmark pagination page limit reached');
}
