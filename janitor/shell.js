import { findBoundary, trimAtBoundary } from '../src/boundary.js';
import { locateCompletionRequest } from './shape.js';
import { isJanitorAlphaUrl, isTargetedCompletion, recordEnvelope, currentEnvelope } from './envelope.js';
import { createBoundaryFilter } from './sse.js';
import { recordStopRejected } from './stop-routes.js';

// stop-parameter-pattern: the one body test that learns a route → docs/modules/janitor-transport.md#stop-rejection-learning
const STOP_PARAMETER_PATTERN = /\bstop(?:_sequences)?\b/i;

const warnedStopRoutes = new Set();

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

function copyResponseMetadata(wrapped, response) {
  for (const property of ['url', 'redirected', 'type']) {
    Object.defineProperty(wrapped, property, {
      configurable: true,
      enumerable: false,
      value: response[property],
    });
  }
  return wrapped;
}

// completion-report: one call per delivered body, never for a pass-through → docs/modules/janitor-adapter.md#boundary-records
function reportCompletion(plan, boundaryHit, text) {
  if (!plan?.onCompletion) return;
  try {
    plan.onCompletion({ boundaryHit, text });
  } catch {
    return;
  }
}

// response-wrapper: fresh stream, filtered at the reserved literal; metadata copied on → docs/modules/janitor-transport.md#response-wrapper
function wrapResponse(response, plan) {
  if (!response?.body) return response;
  const filter = createBoundaryFilter(typeof plan?.literal === 'string' ? plan.literal : '');
  const reader = response.body.getReader();
  let reported = false;
  const finish = () => {
    if (reported) return;
    reported = true;
    reportCompletion(plan, filter.boundaryHit, filter.completionText());
  };
  const stream = new ReadableStream({
    // pull-until-progress: a chunk that completes no record must not end the pull → docs/modules/janitor-transport.md#response-wrapper
    async pull(controller) {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          for (const chunk of filter.flush()) controller.enqueue(chunk);
          controller.close();
          finish();
          return;
        }
        const chunks = filter.push(result.value);
        for (const chunk of chunks) controller.enqueue(chunk);
        if (filter.done) {
          await reader.cancel();
          controller.close();
          finish();
          return;
        }
        if (chunks.length > 0) return;
      }
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
  return copyResponseMetadata(wrapped, response);
}

// non-streaming-json: the chat-completions shape only, read through a clone → docs/modules/janitor-transport.md#response-wrapper
async function deliverJsonCompletion(response, plan) {
  let parsed = null;
  try {
    parsed = JSON.parse(await response.clone().text());
  } catch {
    parsed = null;
  }
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return response;
  if (findBoundary(content, plan.literal).index === -1) {
    reportCompletion(plan, false, content);
    return response;
  }
  parsed.choices[0].message.content = trimAtBoundary(content, plan.literal);
  reportCompletion(plan, true, parsed.choices[0].message.content);
  const rewritten = new Response(JSON.stringify(parsed), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return copyResponseMetadata(rewritten, response);
}

// stop-rejection: a 4xx that names the parameter retires it on this route → docs/modules/janitor-transport.md#stop-rejection-learning
async function learnStopRejection(response, plan) {
  if (response.status < 400 || response.status >= 500) return;
  if (!plan.stopSent || !plan.routeKey) return;
  let body = '';
  try {
    body = await response.clone().text();
  } catch {
    return;
  }
  if (!STOP_PARAMETER_PATTERN.test(body)) return;
  recordStopRejected(plan.routeKey);
  if (warnedStopRoutes.has(plan.routeKey)) return;
  warnedStopRoutes.add(plan.routeKey);
  console.warn(
    `[Manuscript] ${plan.routeKey} refused the stop parameter; later requests on this route rely on the stream cut.`,
  );
}

// deliver: errors untouched, JSON trimmed, everything else filtered on the stream → docs/modules/janitor-transport.md#response-wrapper
async function deliver(response, plan) {
  if (response.status >= 400) {
    await learnStopRejection(response, plan);
    return wrapResponse(response, null);
  }
  const contentType = response.headers.get('content-type') || '';
  if (typeof plan.literal === 'string' && plan.literal !== '' && /(?:application\/json|\+json)/i.test(contentType)) {
    return deliverJsonCompletion(response, plan);
  }
  return wrapResponse(response, plan);
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
    // transform-seam: a falsy return passes through; a plan carries the response side → docs/modules/janitor-transport.md#transform-seam
    const plan = transform(data, { ...currentEnvelope(), url, adapter });
    if (!plan) return wrapResponse(await originalFetch.call(window, resource, config), null);
    if (!plan.modified) return deliver(await originalFetch.call(window, resource, config), plan);
    const outgoing = Object.assign({}, config || {}, { body: JSON.stringify(data) });
    return deliver(await originalFetch.call(window, resource, outgoing), plan);
  };
}
