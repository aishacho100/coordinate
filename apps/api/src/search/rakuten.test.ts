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
) =>
  new RakutenSearcher({
    rakuten,
    fetchImpl,
    cache: new TtlCache<Product[]>({ ttlMs: 1000, maxEntries: 10, now: () => 0 }),
    store: new FileUsageStore(null),
    timeoutMs: 1000,
    hits: 10,
    now: () => NOW,
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
    expect((await make(f400).search('q')).status).toBe('failed');
    const junk: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ Items: 'x' }) });
    expect((await make(junk).search('q')).status).toBe('failed');
    const f = okFetch([item()]);
    const s = make(f);
    await s.search('same');
    expect((await s.search('same')).calls).toBe(0);
    expect(f.urls).toHaveLength(1);
  });
});
