import { mergeAuth, sanitizeCapture } from './bridge.js';
import { savePatch } from './storage.js';

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

    sessionAuth = mergeAuth(sessionAuth, capture);
    const queryIds = { ...sessionAuth.queryIds };
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
