// single-door: only file allowed to name the ST global → docs/modules/host.md#single-door
// never-cache: getCtx() called fresh, never memoized → docs/modules/host.md#never-cache
export function getCtx() {
  return globalThis.SillyTavern.getContext();
}

// capability-gate: presence test, not truthiness → docs/modules/bootstrap.md#capability-gate
export function requireKeys(ctx, names) {
  return names.filter((name) => ctx?.[name] === undefined);
}

// event-alias: eventTypes vs legacy event_types → docs/modules/host.md#event-alias
export function EVENT(ctx) {
  return ctx.eventTypes ?? ctx.event_types;
}
