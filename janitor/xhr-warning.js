import { looksLikeCompletionUrl } from './envelope.js';

let originalOpen = null;
let warned = false;

// xhr-detector: warn once on a completion-shaped open, then delegate → docs/modules/janitor-transport.md#xhr-detector
export function installXhrWarning() {
  if (originalOpen) return;
  originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (!warned && looksLikeCompletionUrl(url)) {
      warned = true;
      console.warn(
        '[Manuscript] Janitor dispatched a completion through XMLHttpRequest. '
          + 'This build hooks fetch only; the XHR route runs on the degraded tier '
          + '(stop strings plus a trim at the next derivation, no live boundary).',
      );
    }
    return originalOpen.call(this, method, url, ...rest);
  };
}
