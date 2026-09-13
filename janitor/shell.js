import { locateCompletionRequest } from './shape.js';
import { isJanitorAlphaUrl, isTargetedCompletion, recordEnvelope, currentEnvelope } from './envelope.js';

let originalFetch = null;

function headerValue(headersInit, name) {
  try {
    return new Headers(headersInit || {}).get(name) || '';
  } catch {
    return '';
  }
}

// inspect-gate: non-empty JSON-looking POST body with a JSON or absent type → docs/modules/janitor-transport.md#request-gating
function shouldInspectRequest(resource, config, bodyText) {
  if (!bodyText) return false;
  if (bodyText.trimStart()[0] !== '{') return false;
  const isRequestObject = resource instanceof Request;
  const method = String(config?.method || (isRequestObject ? resource.method : 'GET')).toUpperCase();
  if (method !== 'POST') return false;
  const contentType = headerValue(config?.headers, 'content-type')
    || (isRequestObject ? resource.headers.get('content-type') || '' : '');
  return !contentType || /(?:application\/json|\+json)/i.test(contentType);
}

// response-wrapper: fresh stream forwards chunks verbatim; metadata copied on → docs/modules/janitor-transport.md#response-wrapper
function wrapResponse(response) {
  if (!response?.body) return response;
  const reader = response.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const wrapped = new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const property of ['url', 'redirected', 'type']) {
    Object.defineProperty(wrapped, property, {
      configurable: true,
      enumerable: false,
      value: response[property],
    });
  }
  return wrapped;
}

// boot-capture: one capture per page, native check warns but never refuses → docs/modules/janitor-transport.md#boot-capture
export function installTransport(transform) {
  if (originalFetch) return;
  originalFetch = window.fetch;
  if (!/\[native code\]/.test(Function.prototype.toString.call(originalFetch))) {
    console.warn(
      '[Manuscript] window.fetch was already wrapped before this script ran. '
        + 'Enable Tampermonkey Advanced → Experimental → Inject Mode: Instant, '
        + 'keep @run-at document-start, then hard reload.',
    );
  }
  window.fetch = async function (resource, config) {
    const isRequestObject = resource instanceof Request;
    const url = isRequestObject ? resource.url : String(resource);
    if (!isJanitorAlphaUrl(url) && !isTargetedCompletion(url)) {
      return originalFetch.call(window, resource, config);
    }
    let bodyText = '';
    try {
      if (config && typeof config.body === 'string') {
        bodyText = config.body;
      } else if (isRequestObject) {
        bodyText = await resource.clone().text();
      }
    } catch {
      bodyText = '';
    }
    if (!shouldInspectRequest(resource, config, bodyText)) {
      return originalFetch.call(window, resource, config);
    }
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return originalFetch.call(window, resource, config);
    }
    const adapter = locateCompletionRequest(data);
    if (!adapter) return originalFetch.call(window, resource, config);
    if (adapter.kind === 'janitor-alpha') {
      recordEnvelope(data);
      return originalFetch.call(window, resource, config);
    }
    // transform-seam: phase-3 boundary; truthy means the body changed → docs/modules/janitor-transport.md#transform-seam
    const modified = transform(data, { ...currentEnvelope(), url, adapter });
    if (!modified) return wrapResponse(await originalFetch.call(window, resource, config));
    const outgoing = Object.assign({}, config || {}, { body: JSON.stringify(data) });
    return wrapResponse(await originalFetch.call(window, resource, outgoing));
  };
}
