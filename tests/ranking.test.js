import { describe, it, expect } from 'vitest';
import { assignSaveRank } from '../src/core/ranking.js';

describe('assignSaveRank', () => {
  it('ranks oldest-saved as #1 and newest as #N', () => {
    const newestFirst = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    expect(assignSaveRank(newestFirst)).toEqual([
      { id: 'a', saveRank: 3 },
      { id: 'b', saveRank: 2 },
      { id: 'c', saveRank: 1 },
    ]);
  });

  it('handles empty input', () => {
    expect(assignSaveRank([])).toEqual([]);
  });
});
