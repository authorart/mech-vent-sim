/** Deterministic PRNG (mulberry32): a seed always replays the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviates (Box–Muller) from a uniform source. */
export function normalFrom(rnd: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());
}
