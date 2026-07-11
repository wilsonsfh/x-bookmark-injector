import { countLeft } from './core/count.js';

const $ = (id) => document.getElementById(id);
let currentSettings = { confirmRealDelete: true, deleteConfirmed: false };
let noticeVersion = 0;
let activeUndo = null;
let pendingRowActions = 0;
let requestedRenderGeneration = 0;
let renderInFlight = null;

function normalizeSettings(settings) {
  return {
    confirmRealDelete: settings?.confirmRealDelete !== false,
    deleteConfirmed: settings?.deleteConfirmed === true,
  };
}

function errorMessage(result, fallback) {
  return result?.ok === false && typeof result.error === 'string'
    ? result.error
    : fallback;
}

function showError(message) {
  if (activeUndo) return;
  noticeVersion += 1;
  $('error').hidden = !message;
  $('error').textContent = message ?? '';
}

function announce(message) {
  $('activity').textContent = message ?? '';
}

function focusDone(tweetId) {
  const row = $('list').querySelectorAll('article')
    .find((candidate) => candidate.getAttribute('data-tweet-id') === tweetId);
  row?.querySelectorAll('button')
    .find((button) => button.textContent === 'Done')
    ?.focus();
}

function showUndoExpired(session) {
  if (activeUndo !== session) return;
  activeUndo = null;
  const notice = $('error');
  notice.hidden = false;
  notice.setAttribute('aria-busy', 'false');
  notice.textContent = 'Undo window expired';
  announce('Undo window expired');
  $('sync').focus();
}

function showUndo(tweetId, undoUntil) {
  const version = ++noticeVersion;
  const notice = $('error');
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'Undo';
  undo.setAttribute('aria-label', 'Undo bookmark removal');
  const session = { tweetId, undoUntil, undo, version, pending: false, expired: false };

  undo.addEventListener('click', async () => {
    session.pending = true;
    undo.disabled = true;
    undo.textContent = 'Restoring…';
    undo.setAttribute('aria-label', 'Restoring bookmark');
    notice.setAttribute('aria-busy', 'true');
    announce('Restoring bookmark');
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action: 'undo', tweetId });
    } catch (error) {
      result = { ok: false, error: String(error.message ?? error) };
    }

    if (result?.ok === true) {
      activeUndo = null;
      notice.setAttribute('aria-busy', 'false');
      announce('');
      await render();
      focusDone(tweetId);
      return;
    }

    session.pending = false;
    if (session.expired || Date.now() >= undoUntil) {
      showUndoExpired(session);
      return;
    }

    undo.disabled = false;
    undo.textContent = 'Undo';
    undo.setAttribute('aria-label', 'Undo bookmark removal');
    notice.setAttribute('aria-busy', 'false');
    notice.hidden = false;
    notice.replaceChildren(`${errorMessage(result, 'Undo failed')}. `, undo);
    announce(errorMessage(result, 'Undo failed'));
    undo.focus();
  });

  notice.hidden = false;
  notice.setAttribute('aria-busy', 'false');
  notice.replaceChildren('Removed from X. ', undo);
  activeUndo = session;
  announce('Bookmark removed. Undo available');
  undo.focus();
  setTimeout(() => {
    if (activeUndo !== session || Date.now() < undoUntil) return;
    session.expired = true;
    if (!session.pending) showUndoExpired(session);
  }, Math.max(0, undoUntil - Date.now()));
}

function setActionsPending(actions, activeButton, pendingLabel, pendingAccessibleLabel) {
  for (const actionButton of actions.querySelectorAll('button')) actionButton.disabled = true;
  actions.setAttribute('aria-busy', 'true');
  activeButton.textContent = pendingLabel;
  activeButton.setAttribute('aria-label', pendingAccessibleLabel);
  announce(pendingAccessibleLabel.replace(/ by .+$/, ''));
}

function restoreActions(actions, activeButton, label, accessibleLabel) {
  for (const actionButton of actions.querySelectorAll('button')) actionButton.disabled = false;
  actions.setAttribute('aria-busy', 'false');
  activeButton.textContent = label;
  activeButton.setAttribute('aria-label', accessibleLabel);
  announce('');
}

function actionButton(label, action, bookmark, actions) {
  const actor = bookmark.author || bookmark.handle || 'Unknown author';
  const accessibleLabel = `${label} bookmark by ${actor}`;
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-label', accessibleLabel);
  element.addEventListener('click', async () => {
    if (action === 'done' && currentSettings.confirmRealDelete && currentSettings.deleteConfirmed !== true) {
      const approved = window.confirm('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
      if (!approved) return;
    }

    showError(null);
    pendingRowActions += 1;
    const pendingVerb = action === 'done' ? 'Removing' : 'Keeping';
    setActionsPending(actions, element, `${pendingVerb}…`, `${pendingVerb} bookmark by ${actor}`);
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: 'XBI_ACTION',
        action,
        tweetId: bookmark.id,
      });
    } catch (error) {
      result = { ok: false, error: String(error.message ?? error) };
    }

    const validSuccess = result?.ok === true
      && (action !== 'done'
        || (Number.isFinite(result.undoUntil) && result.undoUntil > Date.now()));
    if (!validSuccess) {
      pendingRowActions -= 1;
      restoreActions(actions, element, label, accessibleLabel);
      await render();
      showError(errorMessage(result, 'Action failed'));
      return;
    }

    pendingRowActions -= 1;
    restoreActions(actions, element, label, accessibleLabel);
    await render();
    if (action === 'done') showUndo(bookmark.id, result.undoUntil);
  });
  return element;
}

function safeXUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function bookmarkRow(bookmark) {
  const row = document.createElement('article');
  row.className = 'item';
  row.setAttribute('data-tweet-id', bookmark.id);

  const head = document.createElement('div');
  head.className = 'item-head';
  const author = document.createElement('strong');
  author.textContent = bookmark.author || bookmark.handle || 'Unknown';
  const rank = document.createElement('span');
  rank.className = 'rank';
  rank.textContent = `#${bookmark.saveRank}`;
  head.append(author, rank);

  const snippet = document.createElement('div');
  snippet.className = 'snippet';
  snippet.textContent = bookmark.text ?? '';

  const footer = document.createElement('div');
  footer.className = 'item-footer';
  const bookmarkUrl = safeXUrl(bookmark.url);
  const open = document.createElement(bookmarkUrl ? 'a' : 'span');
  if (bookmarkUrl) {
    open.className = 'open-link';
    open.href = bookmarkUrl;
    open.textContent = 'Open bookmark on X';
    open.setAttribute('target', '_blank');
    open.setAttribute('rel', 'noopener noreferrer');
  } else {
    open.className = 'muted';
    open.textContent = 'Link unavailable';
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    actionButton('Keep', 'keep', bookmark, actions),
    actionButton('Done', 'done', bookmark, actions),
  );
  footer.append(open, actions);
  row.append(head, snippet, footer);
  return row;
}

function emptyRow(message) {
  const row = document.createElement('div');
  row.className = 'item muted';
  row.textContent = message;
  return row;
}

function commitState(state) {
  const bookmarksById = state.bookmarks && typeof state.bookmarks === 'object'
    ? state.bookmarks
    : {};
  const cleared = state.cleared && typeof state.cleared === 'object' ? state.cleared : {};
  const allBookmarks = Object.values(bookmarksById);
  const bookmarks = allBookmarks
    .filter((bookmark) => bookmark && cleared[bookmark.id]?.action !== 'done')
    .sort((a, b) => a.saveRank - b.saveRank);

  currentSettings = normalizeSettings(state.settings);
  $('left').textContent = countLeft(bookmarksById, cleared);
  $('total').textContent = allBookmarks.length;
  const syncDate = state.meta?.lastSync ? new Date(state.meta.lastSync) : null;
  $('lastSync').textContent = syncDate && Number.isFinite(syncDate.getTime())
    ? `Synced ${syncDate.toLocaleString()}`
    : 'Never synced';
  $('confirmDelete').checked = currentSettings.confirmRealDelete;
  showError(typeof state.meta?.syncError === 'string' ? state.meta.syncError : null);
  if (pendingRowActions === 0) {
    const emptyMessage = allBookmarks.length === 0
      ? 'No cached bookmarks yet. Open X, initialize capture, then Sync.'
      : 'All caught up. No bookmarks left.';
    $('list').replaceChildren(...(bookmarks.length
      ? bookmarks.map(bookmarkRow)
      : [emptyRow(emptyMessage)]));
  }
}

function commitLoadError(error) {
  currentSettings = normalizeSettings();
  $('left').textContent = '—';
  $('total').textContent = '—';
  $('lastSync').textContent = 'State unavailable';
  showError(String(error.message ?? error));
  if (pendingRowActions === 0) {
    $('list').replaceChildren(emptyRow('Unable to load bookmarks. Try opening X and reopening this popup.'));
  }
}

async function drainRenders() {
  let processedGeneration = 0;
  $('list').setAttribute('aria-busy', 'true');
  while (processedGeneration < requestedRenderGeneration) {
    const generation = requestedRenderGeneration;
    let state;
    let failure;
    try {
      state = await chrome.runtime.sendMessage({ type: 'XBI_GET_STATE' });
      if (!state || typeof state !== 'object' || state.ok === false) {
        throw new Error(typeof state?.error === 'string' ? state.error : 'Unable to load bookmarks');
      }
    } catch (error) {
      failure = error;
    }
    processedGeneration = generation;
    if (generation !== requestedRenderGeneration) continue;
    if (failure) commitLoadError(failure);
    else commitState(state);
  }
  $('list').setAttribute('aria-busy', 'false');
}

function render() {
  requestedRenderGeneration += 1;
  if (!renderInFlight) {
    renderInFlight = drainRenders().finally(() => { renderInFlight = null; });
  }
  return renderInFlight;
}

$('sync').addEventListener('click', async () => {
  const sync = $('sync');
  sync.disabled = true;
  sync.textContent = 'Syncing…';
  sync.setAttribute('aria-label', 'Syncing bookmarks');
  sync.setAttribute('aria-busy', 'true');
  announce('Syncing bookmarks');
  showError(null);
  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'XBI_SYNC' });
  } catch (error) {
    result = { ok: false, error: String(error.message ?? error) };
  }
  await render();
  if (result?.ok !== true) showError(errorMessage(result, 'Sync failed'));
  sync.disabled = false;
  sync.textContent = 'Sync now';
  sync.setAttribute('aria-label', 'Sync bookmarks');
  sync.setAttribute('aria-busy', 'false');
  announce('');
});

$('confirmDelete').addEventListener('change', async (event) => {
  const toggle = event.currentTarget;
  const previous = !toggle.checked;
  toggle.disabled = true;
  toggle.setAttribute('aria-busy', 'true');
  announce('Updating delete confirmation setting');
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'XBI_UPDATE_SETTINGS',
      patch: { confirmRealDelete: toggle.checked },
    });
    if (result?.ok !== true) throw new Error(errorMessage(result, 'Unable to update setting'));
    currentSettings = { ...currentSettings, confirmRealDelete: toggle.checked };
  } catch (error) {
    toggle.checked = previous;
    showError(String(error.message ?? error));
  } finally {
    toggle.disabled = false;
    toggle.setAttribute('aria-busy', 'false');
    announce('');
  }
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (!areaName || areaName === 'local') void render();
});

void render();
