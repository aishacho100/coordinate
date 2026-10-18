import type { Product } from '@coordinate/shared';

import { TtlCache } from '../cache/ttl-cache';
import { FileUsageStore } from '../usage/usage-store';
import { RakutenSearcher } from './rakuten';
import type { FetchLike } from './types';

const NOW = new Date('2026-10-18T03:00:00Z');
const item = (over: Record<string, unknown> = {}) => ({
  Item: {
    itemName: 'ナイキ エアフォース1 メンズ スニーカー ホワイト',
    itemCode: 'alpen:10526255',
    itemPrice: 7590,
    itemUrl: 'https://hb.afl.rakuten.co.jp/ichiba/x/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Falpen%2F1%2F',
    shopName: 'アルペン楽天市場店',
    mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/alpen/a.jpg?_ex=128x128' }],
    availability: 1,
    ...over,
  },
});
const okFetch = (items: unknown[]): FetchLike & { urls: string[] } => {
  const f = (async (url: string) => {
    f.urls.push(url);
    return { ok: true, status: 200, json: async () => ({ count: items.length, Items: items }) };
  }) as FetchLike & { urls: string[] };
  f.urls = [];
  return f;
};
const make = (
  fetchImpl: FetchLike,
  rakuten: { applicationId: string; accessKey: string; affiliateId: string | null } | null = {
    applicationId: 'APP',
    accessKey: 'AK',
    affiliateId: 'AF',
  },
  extra: Partial<ConstructorParameters<typeof RakutenSearcher>[0]> = {},
) =>
  new RakutenSearcher({
    rakuten,
    fetchImpl,
    cache: new TtlCache<Product[]>({ ttlMs: 1000, maxEntries: 10, now: () => 0 }),
    store: new FileUsageStore(null),
    timeoutMs: 1000,
    hits: 10,
    now: () => NOW,
    minIntervalMs: 0,
    ...extra,
  });

describe('RakutenSearcher', () => {
  it('新しいエンドポイントを accessKey をクエリで付けて呼び、Product に整える', async () => {
    const f = okFetch([item()]);
    const r = await make(f).search('ナイキ エアフォース1');
    expect(f.urls[0]).toContain('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?');
    expect(f.urls[0]).toContain('applicationId=APP');
    expect(f.urls[0]).toContain('accessKey=AK');
    expect(f.urls[0]).toContain('affiliateId=AF');
    expect(f.urls[0]).toContain('hits=10');
    expect(r.status).toBe('ok');
    expect(r.products[0]).toMatchObject({
      source: 'rakuten',
      productId: 'alpen:10526255',
      seller: 'アルペン楽天市場店',
      price: { amount: 7590, currency: 'JPY', kind: 'market' },
    });
    expect(r.products[0]?.imageUrl).toContain('thumbnail.image.rakuten.co.jp');
  });
  it('affiliateUrl があれば pageUrl に使い、無ければ itemUrl を使う', async () => {
    const aff = 'https://hb.afl.rakuten.co.jp/ichiba/AF/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fa%2F1%2F';
    const plain = 'https://item.rakuten.co.jp/a/1/';
    const f = okFetch([
      item({ itemCode: 'a:1', itemUrl: plain, affiliateUrl: aff }),
      item({ itemCode: 'a:2', itemUrl: plain }),
    ]);
    const r = await make(f).search('q');
    expect(r.products[0]?.pageUrl).toBe(aff);
    expect(r.products[1]?.pageUrl).toBe(plain);
  });
  it('https 以外の URL は pageUrl に使わない(affiliateUrl が http なら itemUrl、両方だめなら空)', async () => {
    const f = okFetch([
      item({ itemCode: 'a:1', itemUrl: 'https://item.rakuten.co.jp/a/1/', affiliateUrl: 'http://hb.afl.rakuten.co.jp/x' }),
      item({ itemCode: 'a:2', itemUrl: 'http://item.rakuten.co.jp/a/2/', affiliateUrl: 'javascript:alert(1)' }),
    ]);
    const r = await make(f).search('q');
    expect(r.products[0]?.pageUrl).toBe('https://item.rakuten.co.jp/a/1/');
    expect(r.products[1]?.pageUrl).toBeUndefined();
  });
  it('affiliateId が無ければクエリに付けない', async () => {
    const f = okFetch([]);
    await make(f, { applicationId: 'APP', accessKey: 'AK', affiliateId: null }).search('q');
    expect(f.urls[0]).not.toContain('affiliateId');
  });
  it('在庫なし(availability 0)の商品は価格を出さない', async () => {
    const r = await make(okFetch([item({ availability: 0 })])).search('q');
    expect(r.products[0]?.price).toBeUndefined();
  });
  it('未設定・失敗・不正な応答・キャッシュ', async () => {
    expect((await make(okFetch([]), null).search('q')).status).toBe('not_configured');
    const f400: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ errors: {} }) });
    const r400 = await make(f400).search('q');
    expect(r400.status).toBe('failed');
    expect(r400.detail).toBe('http_400');
    const junk: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ Items: 'x' }) });
    const rj = await make(junk).search('q');
    expect(rj.status).toBe('failed');
    expect(rj.detail).toBe('parse');
    const boom: FetchLike = async () => {
      throw new Error('x');
    };
    expect((await make(boom).search('q')).detail).toBe('network');
    const f = okFetch([item()]);
    const s = make(f);
    await s.search('same');
    expect((await s.search('same')).calls).toBe(0);
    expect(f.urls).toHaveLength(1);
  });

  describe('呼び出し間隔', () => {
    /** 偽の時計。sleep した分だけ進み、実際には待たない。 */
    const fakeClock = () => {
      const c = { t: 1000, sleeps: [] as number[], sent: [] as number[] };
      return {
        c,
        extra: {
          clockMs: () => c.t,
          sleep: async (ms: number) => {
            c.sleeps.push(ms);
            c.t += ms;
          },
        },
      };
    };
    const stampedFetch =
      (c: { t: number; sent: number[] }): FetchLike =>
      async () => {
        c.sent.push(c.t);
        return { ok: true, status: 200, json: async () => ({ count: 0, Items: [] }) };
      };

    it('既定は 1100ms。前の送信から最小間隔が経つまで待ってから送る', async () => {
      const { c, extra } = fakeClock();
      const s = make(stampedFetch(c), undefined, { ...extra, minIntervalMs: undefined });
      await s.search('a');
      expect(c.sleeps).toEqual([]);
      c.t += 300;
      await s.search('b');
      expect(c.sleeps).toEqual([800]);
      expect(c.sent[1]! - c.sent[0]!).toBe(1100);
    });

    it('十分に間が空いていれば待たない', async () => {
      const { c, extra } = fakeClock();
      const s = make(stampedFetch(c), undefined, { ...extra, minIntervalMs: 500 });
      await s.search('a');
      c.t += 600;
      await s.search('b');
      expect(c.sleeps).toEqual([]);
    });

    it('キャッシュ命中のときは待たない', async () => {
      const { c, extra } = fakeClock();
      const s = make(stampedFetch(c), undefined, { ...extra, minIntervalMs: 1100 });
      await s.search('same');
      await s.search('same');
      expect(c.sleeps).toEqual([]);
      expect(c.sent).toHaveLength(1);
    });

    it('並行して呼んでも直列化し、送信は最小間隔を空ける', async () => {
      const { c, extra } = fakeClock();
      const s = make(stampedFetch(c), undefined, { ...extra, minIntervalMs: 1000 });
      await Promise.all([s.search('a'), s.search('b'), s.search('c')]);
      expect(c.sent).toEqual([1000, 2000, 3000]);
    });

    it('429 を受けても再試行せず failed(http_429)にする', async () => {
      const { c, extra } = fakeClock();
      let n = 0;
      const f429: FetchLike = async () => {
        n++;
        return { ok: false, status: 429, json: async () => ({}) };
      };
      const r = await make(f429, undefined, extra).search('a');
      expect(r).toMatchObject({ status: 'failed', detail: 'http_429' });
      expect(n).toBe(1);
      expect(c.sleeps).toEqual([]);
    });
  });
});
