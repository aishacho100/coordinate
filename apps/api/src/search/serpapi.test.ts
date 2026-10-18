import type { Product } from '@coordinate/shared';

import { TtlCache } from '../cache/ttl-cache';
import { FileUsageStore } from '../usage/usage-store';
import { SerpApiSearcher } from './serpapi';
import type { FetchLike } from './types';

const NOW = new Date('2026-10-18T03:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  title: 'NIKE Air FORCE 1 07 Men',
  product_id: '123',
  product_link: 'https://www.google.com/search?ibp=oshop&q=x&prds=catalogid:1',
  source: 'Nike Japan',
  price: '￥16,500',
  extracted_price: 16500,
  thumbnail: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc',
  serpapi_thumbnail: 'https://serpapi.com/images/url/abc.webp',
  ...over,
});
const okFetch = (rows: unknown[]): FetchLike & { urls: string[] } => {
  const f = (async (url: string) => {
    f.urls.push(url);
    return { ok: true, status: 200, json: async () => ({ shopping_results: rows }) };
  }) as FetchLike & { urls: string[] };
  f.urls = [];
  return f;
};
const make = (
  fetchImpl: FetchLike,
  over: {
    key?: string | null;
    limit?: number;
    hourly?: number;
    timeoutMs?: number;
    onWarn?: (message: string) => void;
    now?: () => Date;
  } = {},
) => {
  const store = new FileUsageStore(null);
  const cache = new TtlCache<Product[]>({ ttlMs: 1000, maxEntries: 10, now: () => 0 });
  const s = new SerpApiSearcher({
    apiKey: over.key === undefined ? 'KEY' : over.key,
    fetchImpl,
    cache,
    store,
    monthlyLimit: over.limit ?? 200,
    hourlyLimit: over.hourly ?? 45,
    timeoutMs: over.timeoutMs ?? 1000,
    now: over.now ?? (() => NOW),
    onWarn: over.onWarn,
  });
  return { s, store };
};

describe('SerpApiSearcher', () => {
  it('Google Shopping を日本向けで呼び、Product に整える', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f);
    const r = await s.search('nike air force 1 白');
    expect(r.status).toBe('ok');
    expect(r.calls).toBe(1);
    expect(f.urls[0]).toContain('engine=google_shopping');
    expect(f.urls[0]).toContain('gl=jp');
    expect(f.urls[0]).toContain('hl=ja');
    expect(f.urls[0]).toContain('json_restrictor=shopping_results');
    expect(r.products[0]).toMatchObject({
      source: 'google_shopping',
      productId: '123',
      name: 'NIKE Air FORCE 1 07 Men',
      brand: '',
      seller: 'Nike Japan',
      pageUrl: expect.stringContaining('google.com/search'),
      imageUrl: 'https://serpapi.com/images/url/abc.webp',
      price: { amount: 16500, currency: 'JPY', kind: 'market' },
    });
    expect(r.products[0]?.price?.fetchedAt).toBe(NOW.toISOString());
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('https 以外の product_link は pageUrl を空にする', async () => {
    const { s } = make(okFetch([row({ product_link: 'http://www.google.com/x' }), row({ product_id: '2', product_link: 'javascript:alert(1)' })]));
    const r = await s.search('q');
    expect(r.products).toHaveLength(2);
    expect(r.products.every((p) => p.pageUrl === undefined)).toBe(true);
  });

  it('画像は serpapi_thumbnail のみ使い、無い・許可されないときは imageUrl を付けない(gstatic は使わない)', async () => {
    const { s } = make(
      okFetch([
        row({ serpapi_thumbnail: undefined }),
        row({ product_id: '2', serpapi_thumbnail: 'https://evil.example.com/images/url/a.webp' }),
      ]),
    );
    const r = await s.search('q');
    expect(r.products).toHaveLength(2);
    expect(r.products.every((p) => p.imageUrl === undefined)).toBe(true);
  });

  it('価格が取れない行は price を空にする(推測しない)', async () => {
    const { s } = make(okFetch([row({ price: undefined, extracted_price: undefined })]));
    expect((await s.search('q')).products[0]?.price).toBeUndefined();
  });

  it('同じ検索語はキャッシュから返し、外部へ送らない', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f);
    await s.search('q');
    const second = await s.search('q');
    expect(second.calls).toBe(0);
    expect(second.status).toBe('ok');
    expect(f.urls).toHaveLength(1);
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('キー未設定なら not_configured で、外部へ送らない', async () => {
    const f = okFetch([]);
    const r = await make(f, { key: null }).s.search('q');
    expect(r).toEqual({ status: 'not_configured', products: [], calls: 0 });
    expect(f.urls).toHaveLength(0);
  });

  it('月間上限に達していたら budget_exhausted', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f, { limit: 1 });
    store.addMonthly(NOW, { serpapi: 1 });
    expect((await s.search('q')).status).toBe('budget_exhausted');
    expect(f.urls).toHaveLength(0);
  });

  it('HTTP エラー・通信失敗・不正な応答は failed。再試行しない', async () => {
    const bad: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const boom: FetchLike = async () => {
      throw new Error('network');
    };
    const junk: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ shopping_results: 5 }) });
    const expected = ['http_429', 'network', 'parse'];
    for (const [i, f] of [bad, boom, junk].entries()) {
      const r = await make(f).s.search('q');
      expect(r.status).toBe('failed');
      expect(r.products).toEqual([]);
      expect(r.detail).toBe(expected[i]);
    }
  });

  it('タイムアウトは detail が timeout', async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))));
    const { s } = make(hang, { timeoutMs: 20 });
    expect((await s.search('q')).detail).toBe('timeout');
  });

  it('通信に失敗しても、先に予約した 1 回は戻さず、calls も 1 と数える', async () => {
    const boom: FetchLike = async () => {
      throw new Error('network');
    };
    const { s, store } = make(boom);
    const r = await s.search('q');
    expect(r).toEqual({ status: 'failed', products: [], calls: 1, detail: 'network' });
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('上限の確認と同時に予約するので、同時に検索しても上限を超えて送らない', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f, { limit: 1 });
    const results = await Promise.all([s.search('q1'), s.search('q2'), s.search('q3')]);
    expect(results.map((r) => r.status).sort()).toEqual(['budget_exhausted', 'budget_exhausted', 'ok']);
    expect(f.urls).toHaveLength(1);
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('結果が 0 件(shopping_results が無い応答)でも、失敗ではなく「結果なし」の ok として扱う', async () => {
    const f: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: "Google hasn't returned any results" }),
    });
    const r = await make(f).s.search('q');
    expect(r.status).toBe('ok');
    expect(r.products).toEqual([]);
  });

  it('月間上限の 80% に達したら警告を 1 度だけ出す(キーや検索語は含めない)', async () => {
    const warns: string[] = [];
    const { s, store } = make(okFetch([row()]), { limit: 10, onWarn: (m) => warns.push(m) });
    store.addMonthly(NOW, { serpapi: 6 });
    await s.search('secret-query-1'); // 7 回目: まだ 80% 未満
    expect(warns).toHaveLength(0);
    await s.search('secret-query-2'); // 8 回目: 80% に到達
    expect(warns).toHaveLength(1);
    await s.search('secret-query-3');
    await s.search('secret-query-4');
    expect(warns).toHaveLength(1);
    expect(warns[0]).not.toContain('KEY');
    expect(warns[0]).not.toContain('secret-query');
  });
  describe('1 時間の枠と 429 の冷却', () => {
    it('直近 1 時間の回数が上限に達していたら budget_exhausted で、送らない', async () => {
      const f = okFetch([row()]);
      const { s, store } = make(f, { hourly: 3 });
      store.addSerpapi(NOW, 3);
      expect((await s.search('q')).status).toBe('budget_exhausted');
      expect(f.urls).toHaveLength(0);
    });

    it('送るたびに 1 時間の回数も増え、上限に達したら止まる。1 時間後には再び送れる', async () => {
      let t = NOW.getTime();
      const f = okFetch([row()]);
      const { s, store } = make(f, { hourly: 2, now: () => new Date(t) });
      expect((await s.search('a')).status).toBe('ok');
      expect((await s.search('b')).status).toBe('ok');
      expect(store.serpapiLastHour(new Date(t))).toBe(2);
      expect((await s.search('c')).status).toBe('budget_exhausted');
      t += 61 * 60_000;
      expect((await s.search('c')).status).toBe('ok');
    });

    it('Lens など他の呼び出しも同じ 1 時間の枠で数える', async () => {
      const f = okFetch([row()]);
      const { s, store } = make(f, { hourly: 2 });
      store.addSerpapi(NOW, 2);
      expect((await s.search('q')).status).toBe('budget_exhausted');
    });

    it('HTTP 429 は failed(http_429)。その後 5 分間は budget_exhausted で送らず、5 分後に再開する', async () => {
      let t = NOW.getTime();
      let status = 429;
      const calls: string[] = [];
      const f: FetchLike = async (url) => {
        calls.push(url);
        return { ok: status === 200, status, json: async () => ({ shopping_results: [row()] }) };
      };
      const { s } = make(f, { now: () => new Date(t) });
      expect(await s.search('a')).toMatchObject({ status: 'failed', detail: 'http_429' });
      status = 200;
      t += 4 * 60_000;
      expect((await s.search('b')).status).toBe('budget_exhausted');
      expect(calls).toHaveLength(1);
      t += 60_000;
      expect((await s.search('b')).status).toBe('ok');
    });

    it('冷却中でもキャッシュには当たる', async () => {
      const f = okFetch([row()]);
      const { s, store } = make(f);
      await s.search('q');
      store.markSerpapiRateLimited(NOW);
      expect((await s.search('q')).status).toBe('ok');
    });

    it('429 以外の HTTP エラーでは冷却しない', async () => {
      let status = 500;
      const f: FetchLike = async () => ({ ok: status === 200, status, json: async () => ({ shopping_results: [] }) });
      const { s } = make(f);
      await s.search('a');
      status = 200;
      expect((await s.search('b')).status).toBe('ok');
    });
  });
});
