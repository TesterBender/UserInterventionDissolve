import { fromCycleA } from './a.js';

export function fromCycleB() {
  return fromCycleA;
}
