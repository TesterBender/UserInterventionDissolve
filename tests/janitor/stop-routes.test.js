import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JANITOR_STOP_ROUTES_KEY } from '../../janitor/constants.js';
import { stopRouteKey, isStopRejected, recordStopRejected } from '../../janitor/stop-routes.js';

const ROUTE = 'https://relay.example.com/v1/chat/completions?stream=1';

let store;
let storage;

beforeEach(() => {
  store = new Map();
  storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the route key', () => {
  it('is host, path and model, and ignores the query', () => {
    expect(stopRouteKey(ROUTE, 'o4-mini')).toBe('relay.example.com/v1/chat/completions|o4-mini');
  });

  it('separates two models, two paths and two hosts', () => {
    const base = stopRouteKey(ROUTE, 'o4-mini');
    expect(stopRouteKey(ROUTE, 'gpt-test')).not.toBe(base);
    expect(stopRouteKey('https://relay.example.com/v2/chat/completions', 'o4-mini')).not.toBe(base);
    expect(stopRouteKey('https://other.example.com/v1/chat/completions', 'o4-mini')).not.toBe(base);
  });

  it('is empty when the url does not parse and tolerates a missing model', () => {
    expect(stopRouteKey('not a url', 'o4-mini')).toBe('');
    expect(stopRouteKey(ROUTE, undefined)).toBe('relay.example.com/v1/chat/completions|');
  });
});

describe('learning a stop-rejecting route', () => {
  const key = 'relay.example.com/v1/chat/completions|o4-mini';

  it('records the key in its own entry and reads it back', () => {
    expect(isStopRejected(key, storage)).toBe(false);
    recordStopRejected(key, storage);
    expect(JSON.parse(store.get(JANITOR_STOP_ROUTES_KEY))).toEqual([key]);
    expect(isStopRejected(key, storage)).toBe(true);
  });

  it('leaves another route alone and never records a key twice', () => {
    recordStopRejected(key, storage);
    recordStopRejected(key, storage);
    expect(JSON.parse(store.get(JANITOR_STOP_ROUTES_KEY))).toEqual([key]);
    expect(isStopRejected('relay.example.com/v1/chat/completions|gpt-test', storage)).toBe(false);
  });

  it('records nothing for an empty key', () => {
    recordStopRejected('', storage);
    expect(store.has(JANITOR_STOP_ROUTES_KEY)).toBe(false);
    expect(isStopRejected('', storage)).toBe(false);
  });

  it('treats an unparsable or foreign value as nothing learned', () => {
    store.set(JANITOR_STOP_ROUTES_KEY, '{ not json');
    expect(isStopRejected(key, storage)).toBe(false);
    store.set(JANITOR_STOP_ROUTES_KEY, '{"routes":[]}');
    expect(isStopRejected(key, storage)).toBe(false);
    recordStopRejected(key, storage);
    expect(JSON.parse(store.get(JANITOR_STOP_ROUTES_KEY))).toEqual([key]);
  });

  it('survives a read that throws and warns once on a write that throws', () => {
    const broken = {
      getItem: () => { throw new Error('storage disabled'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(isStopRejected(key, broken)).toBe(false);
    recordStopRejected(key, broken);
    recordStopRejected('relay.example.com/v1/chat/completions|gpt-test', broken);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
