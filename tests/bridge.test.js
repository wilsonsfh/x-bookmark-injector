import { describe, expect, it } from 'vitest';
import { captureFromRequest, mergeAuth } from '../src/bridge.js';

describe('page bridge auth capture', () => {
  it('extracts operation auth and allowlisted replay data', () => {
    expect(captureFromRequest(
      'https://x.com/i/api/graphql/read123/Bookmarks?variables=x&features=y&secret=drop-me',
      {
        authorization: 'Bearer web-token',
        'x-csrf-token': 'csrf',
        'x-client-transaction-id': 'tx-1',
        'x-twitter-client-language': 'en',
        cookie: 'must-not-cross-worlds',
        'x-unknown': 'drop-me',
      },
      {
        method: 'POST',
        body: JSON.stringify({
          variables: { cursor: 'next', cookie: 'nested-secret' },
          features: { captured: true },
          authorization: 'Bearer body-secret',
          extra: 'drop-me',
        }),
      },
    )).toEqual({
      operation: 'Bookmarks',
      queryId: 'read123',
      bearer: 'Bearer web-token',
      csrf: 'csrf',
      operationHeaders: {
        'x-client-transaction-id': 'tx-1',
        'x-twitter-client-language': 'en',
      },
      operationTemplate: {
        method: 'POST',
        params: { variables: 'x', features: 'y' },
        body: {
          variables: { cursor: 'next' },
          features: { captured: true },
        },
      },
    });
  });

  it.each([
    'https://x.com/home',
    'https://example.com/i/api/graphql/read123/Bookmarks',
    'http://x.com/i/api/graphql/read123/Bookmarks',
    'https://x.com.evil.test/i/api/graphql/read123/Bookmarks',
    'https://x.com/i/api/graphql/read123/Bookmarks/extra',
    'not a URL',
  ])('ignores non-X GraphQL URL %s', (url) => {
    expect(captureFromRequest(url, {})).toBeNull();
  });

  it('drops malformed bodies rather than retaining raw request data', () => {
    const capture = captureFromRequest(
      'https://x.com/i/api/graphql/read123/Bookmarks',
      {},
      { body: '{not-json' },
    );

    expect(capture.operationTemplate.body).toBeNull();
  });

  it('merges captures by operation without losing prior ids', () => {
    const current = {
      bearer: 'old',
      csrf: 'c1',
      queryIds: { Bookmarks: 'r1' },
      operationHeaders: {},
      operationTemplates: {},
    };
    const capture = {
      operation: 'DeleteBookmark',
      queryId: 'd1',
      bearer: 'new',
      csrf: 'c2',
      operationHeaders: {
        'x-client-transaction-id': 'tx',
        authorization: 'Bearer must-not-be-replayed',
      },
      operationTemplate: {
        method: 'POST',
        params: { features: '{}', secret: 'drop-me' },
        body: {
          features: { captured: true },
          variables: { tweet_id: '1', csrf: 'drop-me' },
          cookie: 'drop-me',
        },
      },
    };

    expect(mergeAuth(current, capture)).toEqual({
      bearer: 'new',
      csrf: 'c2',
      queryIds: { Bookmarks: 'r1', DeleteBookmark: 'd1' },
      operationHeaders: {
        DeleteBookmark: { 'x-client-transaction-id': 'tx' },
      },
      operationTemplates: {
        DeleteBookmark: {
          method: 'POST',
          params: { features: '{}' },
          body: {
            features: { captured: true },
            variables: { tweet_id: '1' },
          },
        },
      },
    });
  });

  it('ignores malformed captures', () => {
    const current = {
      bearer: null,
      csrf: null,
      queryIds: {},
      operationHeaders: {},
      operationTemplates: {},
    };

    expect(mergeAuth(current, {
      operation: '__proto__',
      queryId: 'bad/id',
      bearer: 'Bearer secret',
    })).toEqual(current);
  });
});
