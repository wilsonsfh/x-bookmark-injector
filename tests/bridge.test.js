import { describe, expect, it } from 'vitest';
import {
  captureFromRequest,
  mergeAuth,
  sanitizeCapture,
  TEMPLATE_BUDGETS,
} from '../src/bridge.js';

describe('page bridge auth capture', () => {
  it('extracts operation auth and allowlisted replay data', () => {
    expect(captureFromRequest(
      'https://x.com/i/api/graphql/read123/DeleteBookmark?variables=%7B%22z%22%3A1%2C%22a%22%3A2%7D&features=%7B%22b%22%3Atrue%7D&secret=drop-me',
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
      operation: 'DeleteBookmark',
      queryId: 'read123',
      bearer: 'Bearer web-token',
      csrf: 'csrf',
      operationHeaders: {
        'x-client-transaction-id': 'tx-1',
        'x-twitter-client-language': 'en',
      },
      operationTemplate: {
        method: 'POST',
        params: { variables: '{"a":2,"z":1}', features: '{"b":true}' },
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
      { authorization: 'Bearer web-token', 'x-csrf-token': 'csrf' },
      { body: '{not-json' },
    );

    expect(capture.operationTemplate.body).toBeNull();
  });

  it('parses, recursively sanitizes, and canonically serializes JSON params', () => {
    const variables = JSON.stringify({
      z: 1,
      nested: { z: 2, cookie: 'drop-me', a: 1 },
      authorization: 'drop-me',
      a: 0,
    });
    const capture = captureFromRequest(
      `https://x.com/i/api/graphql/read123/Bookmarks?variables=${encodeURIComponent(variables)}`,
      { authorization: 'Bearer web-token', 'x-csrf-token': 'csrf' },
    );

    expect(capture.operationTemplate.params.variables).toBe(
      '{"a":0,"nested":{"a":1,"z":2},"z":1}',
    );
  });

  it.each([
    '{malformed',
    JSON.stringify({ value: 'x'.repeat(256 * 1024 + 1) }),
    JSON.stringify(Array.from({ length: 10_001 }, () => null)),
    JSON.stringify({ value: 'x'.repeat(1024 * 1024 + 1) }),
  ])('rejects malformed or oversized JSON params', (variables) => {
    expect(sanitizeCapture({
      operation: 'Bookmarks',
      queryId: 'read123',
      bearer: 'Bearer web-token',
      csrf: 'csrf',
      operationHeaders: {},
      operationTemplate: { method: 'GET', params: { variables }, body: null },
    })).toBeNull();
  });

  it('rejects JSON params over the depth budget', () => {
    let nested = true;
    for (let index = 0; index <= 16; index += 1) nested = { nested };

    expect(sanitizeCapture({
      operation: 'Bookmarks',
      queryId: 'read123',
      bearer: 'Bearer web-token',
      csrf: 'csrf',
      operationHeaders: {},
      operationTemplate: {
        method: 'GET',
        params: { features: JSON.stringify(nested) },
        body: null,
      },
    })).toBeNull();
    expect(TEMPLATE_BUDGETS.maxDepth).toBe(16);
  });

  it('treats null and non-object operation templates as empty templates', () => {
    const capture = {
      operation: 'Bookmarks',
      queryId: 'read123',
      bearer: 'Bearer web-token',
      csrf: 'csrf',
      operationHeaders: {},
    };

    expect(sanitizeCapture({ ...capture, operationTemplate: null })?.operationTemplate).toEqual({
      method: 'GET', params: {}, body: null,
    });
    expect(sanitizeCapture({ ...capture, operationTemplate: 'bad' })?.operationTemplate).toEqual({
      method: 'GET', params: {}, body: null,
    });
  });

  it('rejects captures whose method does not match the operation schema', () => {
    expect(sanitizeCapture({
      operation: 'DeleteBookmark',
      queryId: 'delete123',
      bearer: 'Bearer web-token',
      csrf: 'csrf',
      operationHeaders: {},
      operationTemplate: { method: 'GET', params: {}, body: {} },
    })).toBeNull();
  });

  it.each(['UnknownOperation', 'UserByScreenName', 'TweetDetail'])(
    'rejects non-bookmark operation capture %s',
    (operation) => {
      expect(captureFromRequest(
        `https://x.com/i/api/graphql/read123/${operation}`,
        { authorization: 'Bearer web-token', 'x-csrf-token': 'csrf' },
      )).toBeNull();
    },
  );

  it.each([
    [{ authorization: 'Basic wrong', 'x-csrf-token': 'csrf' }, 'read123'],
    [{ authorization: 'Bearer has spaces', 'x-csrf-token': 'csrf' }, 'read123'],
    [{ authorization: 'Bearer web-token', 'x-csrf-token': '' }, 'read123'],
    [{ authorization: `Bearer ${'a'.repeat(600)}`, 'x-csrf-token': 'csrf' }, 'read123'],
    [{ authorization: 'Bearer web-token', 'x-csrf-token': 'c'.repeat(300) }, 'read123'],
    [{ authorization: 'Bearer web-token', 'x-csrf-token': 'csrf' }, 'q'.repeat(300)],
  ])('rejects malformed or oversized auth/query identifiers', (headers, queryId) => {
    expect(captureFromRequest(
      `https://x.com/i/api/graphql/${queryId}/Bookmarks`,
      headers,
    )).toBeNull();
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
      bearer: 'Bearer new',
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
      bearer: 'Bearer new',
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
