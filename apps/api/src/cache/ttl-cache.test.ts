import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('期限内は同じ値を返し、期限を過ぎたら消える', () => {
    let now = 0;
    const c = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10, now: () => now });
    c.set('a', 1);
    now = 999;
    expect(c.get('a')).toBe(1);
    now = 1000;
    expect(c.get('a')).toBeUndefined();
  });
  it('上限を超えたら古いものから捨てる', () => {
    const c = new TtlCache<number>({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });
});
