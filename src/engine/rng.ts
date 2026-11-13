/** PRNG determinista (mulberry32). Misma semilla => misma simulación. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range([min, max]: readonly [number, number]): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.next());
  }

  hex(length: number): string {
    let s = '';
    while (s.length < length) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
}
