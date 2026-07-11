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
