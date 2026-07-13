import { describe, expect, it } from 'vitest';
import { normalizeTweet } from '../src/core/normalize.js';

const raw = {
  rest_id: '1806',
  legacy: {
    full_text: 'I hoard X bookmarks',
    created_at: 'Sat Jun 21 13:37:00 +0000 2026',
    extended_entities: {
      media: [{
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/a.jpg',
        ext_alt_text: 'Diagram of the bookmark workflow',
      }],
    },
  },
  core: {
    user_results: {
      result: {
        legacy: {
          name: 'Zara Zhang',
          screen_name: 'zarazhangrui',
          profile_image_url_https: 'https://pbs.twimg.com/av.jpg',
        },
      },
    },
  },
};

describe('normalizeTweet', () => {
  it('maps a full tweet to a Bookmark', () => {
    expect(normalizeTweet(raw)).toEqual({
      id: '1806',
      url: 'https://x.com/zarazhangrui/status/1806',
      text: 'I hoard X bookmarks',
      author: 'Zara Zhang',
      handle: '@zarazhangrui',
      avatar: 'https://pbs.twimg.com/av.jpg',
      createdAt: '2026-06-21T13:37:00.000Z',
      media: [{
        type: 'photo',
        url: 'https://pbs.twimg.com/a.jpg',
        alt: 'Diagram of the bookmark workflow',
      }],
    });
  });

  it('defaults media to [] when absent', () => {
    const tweet = {
      rest_id: '9',
      legacy: { full_text: 'hi' },
      core: { user_results: { result: { legacy: { screen_name: 'x' } } } },
    };

    expect(normalizeTweet(tweet).media).toEqual([]);
  });

  it('supports current X user core/avatar fields and full Note Tweet text', () => {
    expect(normalizeTweet({
      rest_id: '1812',
      legacy: { full_text: 'Truncated fallback' },
      note_tweet: {
        note_tweet_results: { result: { text: 'The complete long-form bookmarked post' } },
      },
      core: {
        user_results: {
          result: {
            core: { name: 'Current Shape Author', screen_name: 'current_author' },
            avatar: { image_url: 'https://pbs.twimg.com/current-avatar.jpg' },
          },
        },
      },
    })).toMatchObject({
      author: 'Current Shape Author',
      handle: '@current_author',
      avatar: 'https://pbs.twimg.com/current-avatar.jpg',
      text: 'The complete long-form bookmarked post',
      url: 'https://x.com/current_author/status/1812',
    });
  });

  it('returns null when id is missing', () => {
    expect(normalizeTweet({ legacy: {} })).toBeNull();
  });

  it('extracts a one-level quoted post from a quote tweet', () => {
    const quoteTweet = {
      rest_id: '2001',
      legacy: { full_text: 'great read!' },
      core: { user_results: { result: { legacy: { name: 'Brian Chew', screen_name: 'brianchew' } } } },
      quoted_status_result: {
        result: {
          rest_id: '1900',
          legacy: {
            full_text: 'The original long-form thread everyone is quoting.',
            extended_entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/q.jpg' }] },
          },
          core: { user_results: { result: { legacy: { name: 'Origin Author', screen_name: 'origin' } } } },
        },
      },
    };

    expect(normalizeTweet(quoteTweet).quoted).toEqual({
      id: '1900',
      url: 'https://x.com/origin/status/1900',
      text: 'The original long-form thread everyone is quoting.',
      author: 'Origin Author',
      handle: '@origin',
      avatar: '',
      createdAt: null,
      media: [{ type: 'photo', url: 'https://pbs.twimg.com/q.jpg', alt: '' }],
    });
  });

  it('omits quoted when it is absent or malformed and never nests a second quote', () => {
    expect(normalizeTweet({
      rest_id: '2002',
      legacy: { full_text: 'no quote here' },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
    })).not.toHaveProperty('quoted');

    const malformedQuote = normalizeTweet({
      rest_id: '2003',
      legacy: { full_text: 'quote of an id-less post' },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
      quoted_status_result: { result: { legacy: { full_text: 'no id' } } },
    });
    expect(malformedQuote).not.toHaveProperty('quoted');

    const nested = normalizeTweet({
      rest_id: '2004',
      legacy: { full_text: 'outer' },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
      quoted_status_result: {
        result: {
          rest_id: '3000',
          legacy: { full_text: 'inner quote' },
          core: { user_results: { result: { legacy: { screen_name: 'b' } } } },
          quoted_status_result: { result: { rest_id: '4000', legacy: { full_text: 'deepest' } } },
        },
      },
    });
    expect(nested.quoted.text).toBe('inner quote');
    expect(nested.quoted).not.toHaveProperty('quoted');
  });

  it('isolates a malformed quoted post so it never discards the valid bookmark', () => {
    const withBadQuote = normalizeTweet({
      rest_id: '2100',
      legacy: { full_text: 'valid outer post', created_at: 'Wed Jun 25 00:00:00 +0000 2026' },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
      quoted_status_result: {
        result: {
          rest_id: '2101',
          legacy: { full_text: 'quoted post with a broken date', created_at: 'not-a-date' },
          core: { user_results: { result: { legacy: { screen_name: 'b' } } } },
        },
      },
    });

    expect(withBadQuote).not.toBeNull();
    expect(withBadQuote.text).toBe('valid outer post');
    expect(withBadQuote.createdAt).toBe('2026-06-25T00:00:00.000Z');
    expect(withBadQuote).not.toHaveProperty('quoted');
  });

  it('rejects an ID-only or blank-content tweet but preserves text and media variants', () => {
    expect(normalizeTweet({ rest_id: '1806', legacy: { full_text: '   ' } })).toBeNull();
    expect(normalizeTweet({ rest_id: '   ', legacy: { full_text: 'content' } })).toBeNull();
    expect(normalizeTweet({ rest_id: '1807', legacy: { text: 'fallback text' } })).toMatchObject({
      id: '1807',
      text: 'fallback text',
    });
    expect(normalizeTweet({
      rest_id: '1808',
      legacy: {
        full_text: '',
        entities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media.jpg' }] },
      },
    })).toMatchObject({
      id: '1808',
      text: '',
      media: [{ url: 'https://pbs.twimg.com/media.jpg' }],
    });
  });

  it('expands t.co links to readable display URLs and strips media self-links', () => {
    const result = normalizeTweet({
      rest_id: '2200',
      legacy: {
        full_text: 'Read this https://t.co/inline then see https://t.co/media',
        entities: {
          urls: [
            { url: 'https://t.co/inline', expanded_url: 'https://example.com/post', display_url: 'example.com/post' },
          ],
          media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/m.jpg', url: 'https://t.co/media' }],
        },
      },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
    });

    expect(result.text).toBe('Read this example.com/post then see');
  });

  it('surfaces a link-card preview and drops the redundant card shortlink from text', () => {
    const result = normalizeTweet({
      rest_id: '2201',
      legacy: {
        full_text: 'https://t.co/JChQBIThhC',
        entities: {
          urls: [
            { url: 'https://t.co/JChQBIThhC', expanded_url: 'https://posthog.com/blog/x', display_url: 'posthog.com/blog/x' },
          ],
        },
      },
      core: { user_results: { result: { legacy: { name: 'PostHog', screen_name: 'posthog' } } } },
      card: {
        legacy: {
          name: 'summary_large_image',
          url: 'https://t.co/JChQBIThhC',
          binding_values: [
            { key: 'title', value: { string_value: 'Stop being the code review bottleneck', type: 'STRING' } },
            { key: 'vanity_url', value: { string_value: 'posthog.com', type: 'STRING' } },
            { key: 'thumbnail_image_large', value: { image_value: { url: 'https://pbs.twimg.com/card_img/1.jpg' }, type: 'IMAGE' } },
          ],
        },
      },
    });

    expect(result.text).toBe('');
    expect(result.link).toEqual({
      title: 'Stop being the code review bottleneck',
      domain: 'posthog.com',
      image: 'https://pbs.twimg.com/card_img/1.jpg',
    });
  });

  it('keeps a link-only bookmark alive via its X Article title even with empty text', () => {
    const result = normalizeTweet({
      rest_id: '2202',
      legacy: {
        full_text: 'https://t.co/article',
        entities: { urls: [{ url: 'https://t.co/article', display_url: 'posthog.com/blog' }] },
      },
      core: { user_results: { result: { legacy: { screen_name: 'posthog' } } } },
      article: {
        article_results: {
          result: {
            title: 'Stop being the code review bottleneck',
            cover_media_results: { result: { media_info: { original_img_url: 'https://pbs.twimg.com/article/cover.jpg' } } },
          },
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result.text).toBe('posthog.com/blog');
    expect(result.link.title).toBe('Stop being the code review bottleneck');
    expect(result.link.image).toBe('https://pbs.twimg.com/article/cover.jpg');
  });

  it('never discards a bookmark because its card/article shape is malformed', () => {
    const result = normalizeTweet({
      rest_id: '2203',
      legacy: { full_text: 'valid post' },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
      card: { legacy: { binding_values: 'not-an-array' } },
      article: { article_results: { result: 42 } },
    });

    expect(result).not.toBeNull();
    expect(result.text).toBe('valid post');
    expect(result).not.toHaveProperty('link');
  });

  it('normalizes available engagement counts and omits unsafe values', () => {
    expect(normalizeTweet({
      rest_id: '1810',
      legacy: {
        full_text: 'engaging post',
        reply_count: 12,
        retweet_count: 34,
        favorite_count: 56,
        bookmark_count: 78,
      },
      views: { count: '9012' },
    }).engagement).toEqual({
      replies: 12,
      reposts: 34,
      likes: 56,
      views: 9012,
      bookmarks: 78,
    });

    expect(normalizeTweet({
      rest_id: '1811',
      legacy: {
        full_text: 'partial metrics',
        reply_count: -1,
        favorite_count: 'not-a-number',
        bookmark_count: 0,
      },
      views: { count: Number.MAX_SAFE_INTEGER + 1 },
    }).engagement).toEqual({ bookmarks: 0 });
  });
});
