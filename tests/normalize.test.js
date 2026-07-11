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

  it('returns null when id is missing', () => {
    expect(normalizeTweet({ legacy: {} })).toBeNull();
  });
});
