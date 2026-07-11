import { BOOKMARK_FEATURES, OPERATIONS, X_ORIGIN } from './constants.js';

function headersFor(operation, auth) {
  return {
    accept: '*/*',
    'content-type': 'application/json',
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    ...(auth.operationHeaders?.[operation] ?? {}),
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

function resultFromEntry(entry) {
  const direct = entry?.content?.itemContent?.tweet_results?.result;
  if (direct) return [direct.tweet ?? direct];

  return (entry?.content?.items ?? []).map((item) => {
    const result = item?.item?.itemContent?.tweet_results?.result;
    return result?.tweet ?? result;
  }).filter(Boolean);
}

export function parseBookmarks(payload) {
  const instructions = payload?.data?.bookmark_timeline_v2?.timeline?.instructions
    ?? payload?.data?.bookmark_timeline?.timeline?.instructions
    ?? [];
  const entries = instructions.flatMap((instruction) => instruction.entries ?? []);
  const tweets = entries.flatMap(resultFromEntry);
  const nextCursor = entries.find((entry) => entry?.content?.cursorType === 'Bottom')?.content?.value ?? null;
  return { tweets, nextCursor };
}
