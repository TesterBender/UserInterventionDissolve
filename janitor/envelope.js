import { isObject } from './shape.js';

// bridge-window: 5 s, long enough for one generation, too short to cross chats → docs/modules/janitor-transport.md#conversation-binding
export const ROUTE_BINDING_FALLBACK_MS = 5_000;

// completion-url-pattern: copied verbatim from the optimizer, L55–56 → docs/modules/janitor-transport.md#request-gating
const COMPLETION_URL_PATTERN =
  /\/(?:chat\/)?completions?\b|\/(?:v1|api\/v1)\/responses\b|\/v1\/messages\b|:generateContent|\/generate(?:Content|_content)\b|\/generateAlpha\b|\/api\/v1\/chat\b/i;

const envelopeRegistry = new Map();
let latestCapture = null;

function token(value) {
  return String(value ?? '').trim();
}

function normalizedRoutePath(pathname) {
  const path = String(pathname || '/').replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

function conversationIdentity() {
  const pathname = location.pathname;
  const match = /\/chats?\/([^/?#]+)/.exec(pathname);
  return match ? match[1] : pathname;
}

function parseRoute(userConfig) {
  const raw = token(userConfig.open_ai_reverse_proxy);
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw, location.href);
  } catch {
    return null;
  }
  return { url: raw, host: parsed.hostname, path: normalizedRoutePath(parsed.pathname) };
}

function personaNameOf(data) {
  const direct = token(data.profile?.name);
  if (direct) return direct;
  const activeId = token(data.profile?.id);
  if (!activeId || !Array.isArray(data.profiles)) return '';
  const match = data.profiles.find((profile) => isObject(profile) && token(profile.id) === activeId);
  return token(match?.name);
}

// envelope-record: what /generateAlpha gives the later phases, nothing more → docs/modules/janitor-transport.md#envelope-record
export function readEnvelope(data) {
  const userConfig = data.userConfig;
  const settings = userConfig.generation_settings;
  return {
    chatId: token(data.chat?.id),
    characterId: token(data.chat?.character_id),
    personaName: personaNameOf(data),
    generateType: data.generateType,
    prefill: {
      enabled: isObject(settings) && settings.prefill_enabled === true,
      text: isObject(settings) ? token(settings.prefill_text) : '',
    },
    route: parseRoute(userConfig),
    janitorRouterEnabled: userConfig.janitor_router_enabled === true,
    chatMessages: data.chatMessages.map((message, position) => ({
      position,
      // envelope-id: the entry's database id, as a string → docs/modules/janitor-adapter.md#envelope-id-identity
      id: isObject(message) && (typeof message.id === 'string' || Number.isFinite(message.id)) ? String(message.id) : '',
      isMain: isObject(message) && message.is_main === true,
      isBot: isObject(message) && message.is_bot === true,
      message: isObject(message) ? String(message.message ?? '') : '',
    })),
  };
}

// envelope-registry: keyed by URL identity and by chat id, in memory only → docs/modules/janitor-transport.md#conversation-binding
export function recordEnvelope(data) {
  const envelope = readEnvelope(data);
  envelopeRegistry.set(conversationIdentity(), envelope);
  if (envelope.chatId) envelopeRegistry.set(envelope.chatId, envelope);
  latestCapture = { envelope, capturedAt: Date.now() };
  return envelope;
}

// latest-capture-bridge: covers the mid-flight URL mutation of a new chat → docs/modules/janitor-transport.md#conversation-binding
export function currentEnvelope() {
  const exact = envelopeRegistry.get(conversationIdentity());
  if (exact) return exact;
  if (latestCapture && Date.now() - latestCapture.capturedAt < ROUTE_BINDING_FALLBACK_MS) {
    return latestCapture.envelope;
  }
  return null;
}

export function looksLikeCompletionUrl(url) {
  return COMPLETION_URL_PATTERN.test(String(url || ''));
}

export function isJanitorAlphaUrl(url) {
  return /\/generateAlpha\b/i.test(String(url || ''));
}

// route-match: same host, exact path or under the configured base → docs/modules/janitor-transport.md#request-gating
export function routeMatches(url) {
  const route = currentEnvelope()?.route;
  if (!route) return false;
  let candidate;
  try {
    candidate = new URL(String(url || ''), location.href);
  } catch {
    return false;
  }
  if (candidate.hostname !== route.host) return false;
  const candidatePath = normalizedRoutePath(candidate.pathname);
  const exactPath = candidatePath === route.path;
  const routeIsBase = route.path === '/';
  const underConfiguredBase = route.path !== '/' && candidatePath.startsWith(`${route.path}/`);
  return (exactPath || routeIsBase || underConfiguredBase) && COMPLETION_URL_PATTERN.test(candidatePath);
}

// targeted-completion: learned route wins; the pattern is only the no-envelope fallback → docs/modules/janitor-transport.md#request-gating
export function isTargetedCompletion(url) {
  if (isJanitorAlphaUrl(url)) return false;
  if (currentEnvelope()?.route) return routeMatches(url);
  return looksLikeCompletionUrl(url);
}
