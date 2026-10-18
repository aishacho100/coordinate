type Options = { ttlMs: number; maxEntries: number; now?: () => number };

/** メモリだけのキャッシュ。ファイル・DB には保存しない(楽天の規約の範囲に収める)。 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly opts: Options) {
    this.now = opts.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() >= e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.opts.ttlMs });
    while (this.map.size > this.opts.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
