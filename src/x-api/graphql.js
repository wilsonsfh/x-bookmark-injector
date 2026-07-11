import { BOOKMARK_FEATURES, OPERATIONS, X_ORIGIN } from './constants.js';

const CAPTURED_HEADER_DENYLIST = new Set(['authorization', 'x-csrf-token', 'cookie', 'set-cookie']);
const BOOKMARK_CURSOR_TYPES = new Set(['Top', 'Bottom', 'ShowMore', 'ShowMoreThreads', 'Gap']);

function capturedHeadersFor(operation, auth) {
  return Object.fromEntries(Object.entries(auth.operationHeaders?.[operation] ?? {})
    .map(([name, value]) => [name.toLowerCase(), value])
    .filter(([name]) => !CAPTURED_HEADER_DENYLIST.has(name)));
}

function headersFor(operation, auth) {
  return {
    accept: '*/*',
    'content-type': 'application/json',
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    ...capturedHeadersFor(operation, auth),
    authorization: auth.bearer,
    'x-csrf-token': auth.csrf,
  };
}

function requireAuth(operation, auth) {
  const queryId = auth.queryIds?.[operation];
  if (!queryId || !auth.bearer || !auth.csrf) throw new Error('X auth capture incomplete');
  return queryId;
}

export function buildBookmarksRequest(auth, cursor = null) {
  const operation = OPERATIONS.BOOKMARKS;
  const queryId = requireAuth(operation, auth);
  const templateParams = auth.operationTemplates?.[operation]?.params ?? {};
  const variables = JSON.parse(templateParams.variables ?? '{}');
  if (variables.count == null) variables.count = 100;
  if (variables.includePromotedContent == null) variables.includePromotedContent = false;
  if (cursor) variables.cursor = cursor;
  else delete variables.cursor;

  const params = new URLSearchParams(templateParams);
  params.set('variables', JSON.stringify(variables));
  if (!params.has('features')) params.set('features', JSON.stringify(BOOKMARK_FEATURES));

  return {
    url: `${X_ORIGIN}/i/api/graphql/${queryId}/${operation}?${params}`,
    init: { method: 'GET', credentials: 'include', headers: headersFor(operation, auth) },
  };
}

export function buildMutationRequest(operation, auth, tweetId) {
  if (![OPERATIONS.DELETE, OPERATIONS.CREATE].includes(operation)) {
    throw new Error(`Unsupported mutation: ${operation}`);
  }
  if (typeof tweetId !== 'string' || !tweetId.trim()) throw new Error('Tweet ID required');

  const queryId = requireAuth(operation, auth);
  const templateBody = auth.operationTemplates?.[operation]?.body ?? {};
  const body = {
    ...templateBody,
    variables: { ...(templateBody.variables ?? {}), tweet_id: tweetId },
    queryId,
  };

  return {
    url: `${X_ORIGIN}/i/api/graphql/${queryId}/${operation}`,
    init: {
      method: 'POST',
      credentials: 'include',
      headers: headersFor(operation, auth),
      body: JSON.stringify(body),
    },
  };
}

function integrationError() {
  return new Error('X bookmarks integration response invalid');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tweetFromItemContent(itemContent) {
  if (!isRecord(itemContent) || !isRecord(itemContent.tweet_results)
    || !Object.hasOwn(itemContent.tweet_results, 'result')) {
    throw integrationError();
  }
  const result = itemContent.tweet_results.result;
  if (!isRecord(result)) throw integrationError();
  const tweet = Object.hasOwn(result, 'tweet') ? result.tweet : result;
  if (!isRecord(tweet)) throw integrationError();
  const id = tweet.rest_id ?? tweet.legacy?.id_str;
  if (typeof id !== 'string' || !id.trim()) throw integrationError();
  return tweet;
}

function parseEntry(entry) {
  if (!isRecord(entry) || typeof entry.entryId !== 'string' || !entry.entryId
    || !isRecord(entry.content)) {
    throw integrationError();
  }
  const { content, entryId } = entry;
  if (entryId.startsWith('cursor-') || Object.hasOwn(content, 'cursorType')) {
    if (!BOOKMARK_CURSOR_TYPES.has(content.cursorType)
      || typeof content.value !== 'string' || !content.value) {
      throw integrationError();
    }
    return { tweets: [], cursor: content.cursorType === 'Bottom' ? content.value : null };
  }
  if (entryId.startsWith('module-') || Object.hasOwn(content, 'items')) {
    if (!Array.isArray(content.items)) throw integrationError();
    const tweets = [];
    for (const item of content.items) {
      if (!isRecord(item)) throw integrationError();
      const itemContent = item.item?.itemContent;
      const intendedTweet = item.entryId?.startsWith('tweet-')
        || (isRecord(itemContent) && Object.hasOwn(itemContent, 'tweet_results'));
      if (intendedTweet) tweets.push(tweetFromItemContent(itemContent));
    }
    return { tweets, cursor: null };
  }
  if (entryId.startsWith('tweet-') || Object.hasOwn(content, 'itemContent')) {
    return { tweets: [tweetFromItemContent(content.itemContent)], cursor: null };
  }
  throw integrationError();
}

export function parseBookmarks(payload) {
  if (!isRecord(payload)
    || (payload.errors !== undefined
      && (!Array.isArray(payload.errors) || payload.errors.length > 0))) {
    throw integrationError();
  }
  const timeline = payload?.data?.bookmark_timeline_v2?.timeline
    ?? payload?.data?.bookmark_timeline?.timeline;
  if (!Array.isArray(timeline?.instructions)) {
    throw integrationError();
  }

  const tweets = [];
  let nextCursor = null;
  for (const instruction of timeline.instructions) {
    if (!isRecord(instruction) || instruction.type !== 'TimelineAddEntries'
      || !Array.isArray(instruction.entries)) {
      throw integrationError();
    }
    for (const entry of instruction.entries) {
      const parsed = parseEntry(entry);
      tweets.push(...parsed.tweets);
      if (parsed.cursor !== null) nextCursor = parsed.cursor;
    }
  }
  return { tweets, nextCursor };
}
