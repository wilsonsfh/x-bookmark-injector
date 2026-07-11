import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STATE,
  SYNC_TIMEOUT_MS,
  applyDefaults,
  loadState,
  recoverStaleSync,
  savePatch,
} from '../src/storage.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyDefaults', () => {
  it('supplies a complete initial state', () => {
    expect(applyDefaults({})).toEqual({
      bookmarks: {},
      cleared: {},
      pendingActions: {},
      meta: {
        total: 0,
        lastSync: null,
        syncStatus: 'idle',
        syncError: null,
        syncStartedAt: null,
      },
      auth: { queryIds: {} },
      settings: {
        confirmRealDelete: true,
        deleteConfirmed: false,
        keepCooldownHours: 72,
        syncEveryHours: 24,
      },
    });
  });

  it('recovers missing, expired, and future syncing timestamps while preserving fresh syncs', () => {
    const now = Date.parse('2026-07-11T12:00:00Z');
    const syncing = applyDefaults({ meta: { syncStatus: 'syncing' } });
    const fresh = applyDefaults({
      meta: { syncStatus: 'syncing', syncStartedAt: new Date(now - SYNC_TIMEOUT_MS + 1).toISOString() },
    });
    const expired = applyDefaults({
      meta: { syncStatus: 'syncing', syncStartedAt: new Date(now - SYNC_TIMEOUT_MS).toISOString() },
    });
    const future = applyDefaults({
      meta: { syncStatus: 'syncing', syncStartedAt: new Date(now + 1).toISOString() },
    });

    expect(recoverStaleSync(syncing, now).meta.syncStatus).toBe('idle');
    expect(recoverStaleSync(fresh, now)).toBe(fresh);
    expect(recoverStaleSync(expired, now).meta).toMatchObject({ syncStatus: 'idle', syncStartedAt: null });
    expect(recoverStaleSync(future, now).meta.syncStatus).toBe('idle');
  });

  it('deep-merges specified nested state without deleting defaults', () => {
    const state = applyDefaults({
      bookmarks: { one: { id: 'one' } },
      cleared: { two: { action: 'keep' } },
      settings: { keepCooldownHours: 24, cardStyle: 'hybrid' },
      meta: { total: 4 },
      auth: { queryIds: { Bookmarks: 'read123' } },
    });

    expect(state.bookmarks).toEqual({ one: { id: 'one' } });
    expect(state.cleared).toEqual({ two: { action: 'keep' } });
    expect(state.settings).toMatchObject({ keepCooldownHours: 24, syncEveryHours: 24 });
    expect(state.settings).not.toHaveProperty('cardStyle');
    expect(state.meta).toMatchObject({ total: 4, syncStatus: 'idle' });
    expect(state.auth).toEqual({ queryIds: { Bookmarks: 'read123' } });
  });

  it('excludes session credentials and captured request templates', () => {
    const state = applyDefaults({
      auth: {
        queryIds: { Bookmarks: 'read123' },
        bearer: 'Bearer secret',
        csrf: 'csrf-secret',
        operationHeaders: { Bookmarks: { authorization: 'Bearer secret' } },
        operationTemplates: { Bookmarks: { params: { features: '{}' } } },
      },
    });

    expect(DEFAULT_STATE.auth).toEqual({ queryIds: {} });
    expect(state.auth).toEqual({ queryIds: { Bookmarks: 'read123' } });
  });
});

describe('storage helpers', () => {
  it('loads all local storage and applies defaults', async () => {
    const get = vi.fn().mockResolvedValue({ meta: { total: 4 } });
    vi.stubGlobal('chrome', { storage: { local: { get } } });

    await expect(loadState()).resolves.toMatchObject({
      meta: { total: 4, syncStatus: 'idle' },
      settings: { keepCooldownHours: 72 },
    });
    expect(get).toHaveBeenCalledWith(null);
  });

  it('physically removes the legacy Hybrid cardStyle setting on load', async () => {
    const get = vi.fn().mockResolvedValue({
      settings: {
        confirmRealDelete: true,
        deleteConfirmed: false,
        keepCooldownHours: 72,
        syncEveryHours: 24,
        cardStyle: 'hybrid',
      },
    });
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get, set } } });

    const state = await loadState();

    expect(state.settings).not.toHaveProperty('cardStyle');
    expect(set).toHaveBeenCalledWith({ settings: state.settings });
  });

  it('saves the supplied patch to local storage', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const patch = { meta: { total: 4 } };
    vi.stubGlobal('chrome', { storage: { local: { set } } });

    await savePatch(patch);

    expect(set).toHaveBeenCalledWith(patch);
  });
});
