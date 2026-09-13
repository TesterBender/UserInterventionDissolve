import { fromCycleB } from './b.js';

export function fromCycleA() {
  return fromCycleB();
}
