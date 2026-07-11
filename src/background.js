import { mergeAuth, sanitizeCapture } from './bridge.js';
import { savePatch } from './storage.js';
import { OPERATIONS } from './x-api/constants.js';

const PERSISTED_OPERATIONS = Object.values(OPERATIONS);

let sessionAuth = {
  bearer: null,
  csrf: null,
  queryIds: {},
  operationHeaders: {},
  operationTemplates: {},
};
let persistQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'XBI_AUTH_CAPTURE') {
    const capture = sanitizeCapture(message.capture);
    if (!capture) return false;

    const queryIdChanged = sessionAuth.queryIds[capture.operation] !== capture.queryId;
    sessionAuth = mergeAuth(sessionAuth, capture);
    if (!queryIdChanged) {
      sendResponse({ ok: true });
      return false;
    }
    const queryIds = Object.fromEntries(PERSISTED_OPERATIONS
      .filter((operation) => sessionAuth.queryIds[operation])
      .map((operation) => [operation, sessionAuth.queryIds[operation]]));
    persistQueue = persistQueue
      .catch(() => {})
      .then(() => savePatch({ auth: { queryIds } }));
    persistQueue.then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'Unable to persist query IDs' }),
    );
    return true;
  }

  if (message?.type === 'XBI_GET_SESSION_AUTH') {
    sendResponse(sessionAuth);
    return false;
  }
  return false;
});
