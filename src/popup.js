import { countLeft } from './core/count.js';

const $ = (id) => document.getElementById(id);
let currentSettings = {};
let noticeVersion = 0;

function errorMessage(result, fallback) {
  return result?.ok === false && typeof result.error === 'string'
    ? result.error
    : fallback;
}

function showError(message) {
  noticeVersion += 1;
  $('error').hidden = !message;
  $('error').textContent = message ?? '';
}

function showUndo(tweetId, undoUntil) {
  const version = ++noticeVersion;
  const notice = $('error');
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'Undo';

  undo.addEventListener('click', async () => {
    undo.disabled = true;
    undo.textContent = 'Restoring…';
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: 'XBI_ACTION', action: 'undo', tweetId });
    } catch (error) {
      result = { ok: false, error: String(error.message ?? error) };
    }

    if (result?.ok === true) {
      await render();
      return;
    }

    undo.disabled = false;
    undo.textContent = 'Undo';
    notice.hidden = false;
    notice.replaceChildren(`${errorMessage(result, 'Undo failed')}. `, undo);
  });

  notice.hidden = false;
  notice.replaceChildren('Removed from X. ', undo);
  setTimeout(() => {
    if (noticeVersion === version && Date.now() >= undoUntil) showError(null);
  }, Math.max(0, undoUntil - Date.now()));
}

function setActionsPending(actions, activeButton, pendingLabel) {
  for (const actionButton of actions.querySelectorAll('button')) actionButton.disabled = true;
  activeButton.textContent = pendingLabel;
}

function restoreActions(actions, activeButton, label) {
  for (const actionButton of actions.querySelectorAll('button')) actionButton.disabled = false;
  activeButton.textContent = label;
}

function actionButton(label, action, bookmark, actions) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.setAttribute('aria-label', `${label} bookmark by ${bookmark.author || bookmark.handle || 'Unknown author'}`);
  element.addEventListener('click', async () => {
    if (action === 'done' && currentSettings.confirmRealDelete && !currentSettings.deleteConfirmed) {
      const approved = window.confirm('Remove this bookmark from X for real? You will have 6 seconds to Undo.');
      if (!approved) return;
    }

    showError(null);
    setActionsPending(actions, element, action === 'done' ? 'Removing…' : 'Keeping…');
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
      restoreActions(actions, element, label);
      showError(errorMessage(result, 'Action failed'));
      return;
    }

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

async function render() {
  $('list').setAttribute('aria-busy', 'true');
  try {
    const state = await chrome.runtime.sendMessage({ type: 'XBI_GET_STATE' });
    if (!state || typeof state !== 'object' || state.ok === false) {
      throw new Error(typeof state?.error === 'string' ? state.error : 'Unable to load bookmarks');
    }

    const bookmarksById = state.bookmarks && typeof state.bookmarks === 'object'
      ? state.bookmarks
      : {};
    const cleared = state.cleared && typeof state.cleared === 'object' ? state.cleared : {};
    const allBookmarks = Object.values(bookmarksById);
    const bookmarks = allBookmarks
      .filter((bookmark) => bookmark && cleared[bookmark.id]?.action !== 'done')
      .sort((a, b) => a.saveRank - b.saveRank);

    currentSettings = state.settings && typeof state.settings === 'object' ? state.settings : {};
    $('left').textContent = countLeft(bookmarksById, cleared);
    $('total').textContent = allBookmarks.length;
    const syncDate = state.meta?.lastSync ? new Date(state.meta.lastSync) : null;
    $('lastSync').textContent = syncDate && Number.isFinite(syncDate.getTime())
      ? `Synced ${syncDate.toLocaleString()}`
      : 'Never synced';
    $('confirmDelete').checked = currentSettings.confirmRealDelete ?? true;
    showError(typeof state.meta?.syncError === 'string' ? state.meta.syncError : null);
    $('list').replaceChildren(...(bookmarks.length
      ? bookmarks.map(bookmarkRow)
      : [emptyRow('No cached bookmarks yet. Open X, initialize capture, then Sync.')]));
  } catch (error) {
    currentSettings = {};
    $('left').textContent = '—';
    $('total').textContent = '—';
    $('lastSync').textContent = 'State unavailable';
    showError(String(error.message ?? error));
    $('list').replaceChildren(emptyRow('Unable to load bookmarks. Try opening X and reopening this popup.'));
  } finally {
    $('list').setAttribute('aria-busy', 'false');
  }
}

$('sync').addEventListener('click', async () => {
  const sync = $('sync');
  sync.disabled = true;
  sync.textContent = 'Syncing…';
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
});

$('confirmDelete').addEventListener('change', async (event) => {
  const toggle = event.currentTarget;
  const previous = !toggle.checked;
  toggle.disabled = true;
  try {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...settings, confirmRealDelete: toggle.checked },
    });
    currentSettings = { ...currentSettings, confirmRealDelete: toggle.checked };
  } catch (error) {
    toggle.checked = previous;
    showError(String(error.message ?? error));
  } finally {
    toggle.disabled = false;
  }
});

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (!areaName || areaName === 'local') void render();
});

void render();
