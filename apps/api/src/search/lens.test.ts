import type { Product } from '@coordinate/shared';

import { TtlCache } from '../cache/ttl-cache';
import { FileUsageStore } from '../usage/usage-store';
import { LensSearcher, type UploadFetchLike } from './lens';

const NOW = new Date('2026-10-18T03:00:00Z');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** 実 API(2026-10-18 に確認)の応答の形。長い値は短くしてある。 */
const UPLOAD_OK = { message: 'Image uploaded successfully.', image_id: 'WocRw3icu2lgamphnGRm' };
const row = (over: Record<string, unknown> = {}) => ({
  position: 22,
  title: '楽天市場】AmericanOptical AO 1/10-12KGF Vintage 【中古】 : 誠眼鏡店',
  link: 'https://item.rakuten.co.jp/auc-makotoweb/2547481',
  source: '楽天市場',
  source_icon: 'https://serpapi.com/images/i/iVBORw0KGgo.png',
  price: { value: '￥38,770*', extracted_value: 38770, currency: '￥' },
  condition: '中古品',
  thumbnail: 'https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcTJqSqK0nkBVwCjp',
  thumbnail_width: 183,
  thumbnail_height: 276,
  image: 'https://tshop.r10s.jp/auc-makotoweb/cabinet/81/2552816.jpg',
  image_width: 398,
  image_height: 600,
  ...over,
});
const mercariRow = row({
  position: 25,
  title: '常田大希さん着用 mmcraft004 - メルカリ',
  link: 'https://jp.mercari.com/item/m123',
  source: 'Mercari',
  price: undefined,
  condition: undefined,
  thumbnail: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT3cMLkOG',
});

type Call = { url: string; method?: string; body?: unknown };
type Reply = { ok?: boolean; status?: number; body: unknown } | 'throw';
const fakeFetch = (upload: Reply, search: Reply): UploadFetchLike & { calls: Call[] } => {
  const f = (async (url: string, init?: { method?: string; body?: unknown }) => {
    f.calls.push({ url, method: init?.method, body: init?.body });
    const reply = url.startsWith('https://serpapi.com/image') ? upload : search;
    if (reply === 'throw') throw new Error('network down');
    return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => reply.body };
  }) as UploadFetchLike & { calls: Call[] };
  f.calls = [];
  return f;
};

const make = (
  fetchImpl: UploadFetchLike,
  over: { key?: string | null; limit?: number; uploadTimeoutMs?: number; searchTimeoutMs?: number; onWarn?: (m: string) => void } = {},
) => {
  const store = new FileUsageStore(null);
  const cache = new TtlCache<Product[]>({ ttlMs: 1000, maxEntries: 10, now: () => 0 });
  const s = new LensSearcher({
    apiKey: over.key === undefined ? 'KEY' : over.key,
    fetchImpl,
    cache,
    store,
    monthlyLimit: over.limit ?? 200,
    uploadTimeoutMs: over.uploadTimeoutMs ?? 1000,
    searchTimeoutMs: over.searchTimeoutMs ?? 1000,
    now: () => NOW,
    onWarn: over.onWarn,
  });
  return { s, store };
};

describe('LensSearcher', () => {
  it('画像をアップロードし、image_id で google_lens(visual_matches・日本向け)を呼ぶ', async () => {
    const f = fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: [row()] } });
    const { s, store } = make(f);
    const r = await s.searchByImage(JPEG);
    expect(r.status).toBe('ok');
    expect(r.calls).toBe(2);
    expect(f.calls[0]!.url).toBe('https://serpapi.com/image');
    expect(f.calls[0]!.method).toBe('POST');
    const form = f.calls[0]!.body as FormData;
    expect(form.get('api_key')).toBe('KEY');
    const file = form.get('image') as Blob;
    expect(file.type).toBe('image/jpeg');
    expect(file.size).toBe(JPEG.byteLength);
    const search = f.calls[1]!.url;
    expect(search).toContain('https://serpapi.com/search.json?');
    expect(search).toContain('engine=google_lens');
    expect(search).toContain('image_id=WocRw3icu2lgamphnGRm');
    expect(search).toContain('type=visual_matches');
    expect(search).toContain('country=jp');
    expect(search).toContain('hl=ja');
    expect(search).toContain('api_key=KEY');
    // アップロードも 1 回と数える(安全側)。
    expect(store.monthly(NOW).serpapi).toBe(2);
  });

  it('visual_matches を Product に整える(リンクが productId、販売元は source、円の価格は market)', async () => {
    const { s } = make(fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: [row(), mercariRow] } }));
    const r = await s.searchByImage(JPEG);
    expect(r.products).toHaveLength(2);
    expect(r.products[0]).toMatchObject({
      source: 'google_lens',
      productId: 'https://item.rakuten.co.jp/auc-makotoweb/2547481',
      brand: '',
      name: '楽天市場】AmericanOptical AO 1/10-12KGF Vintage 【中古】 : 誠眼鏡店',
      pageUrl: 'https://item.rakuten.co.jp/auc-makotoweb/2547481',
      seller: '楽天市場',
      imageUrl: 'https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcTJqSqK0nkBVwCjp',
      price: { amount: 38770, currency: 'JPY', kind: 'market', fetchedAt: NOW.toISOString() },
    });
    // 価格が無い行は価格なし。
    expect(r.products[1]!.price).toBeUndefined();
    expect(r.products[1]!.seller).toBe('Mercari');
  });

  it('円以外の価格($ など)は付けない', async () => {
    const usd = row({ price: { value: '$17*', extracted_value: 17, currency: '$' } });
    const { s } = make(fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: [usd] } }));
    const r = await s.searchByImage(JPEG);
    expect(r.products).toHaveLength(1);
    expect(r.products[0]!.price).toBeUndefined();
  });

  it('pageUrl は https のみ。それ以外は空(商品名があれば行は残す)', async () => {
    const http = row({ link: 'http://example.com/a' });
    const js = row({ link: 'javascript:alert(1)' });
    const { s } = make(fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: [http, js] } }));
    const r = await s.searchByImage(JPEG);
    expect(r.products).toHaveLength(2);
    expect(r.products.every((p) => p.pageUrl === undefined)).toBe(true);
  });

  it('許可されないサムネイル・サムネイルなしは imageUrl を付けない。商品名が空の行は捨てる', async () => {
    const rows = [
      row({ link: 'https://a.example/1', thumbnail: 'https://evil.example/x.jpg' }),
      row({ link: 'https://a.example/2', thumbnail: undefined }),
      row({ link: 'https://a.example/3', thumbnail: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc' }),
      row({ link: 'https://a.example/4', title: '' }),
      row({ link: 'https://a.example/5', title: undefined }),
      { not: 'a row' },
      'junk',
    ];
    const { s } = make(fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: rows } }));
    const r = await s.searchByImage(JPEG);
    expect(r.status).toBe('ok');
    expect(r.products.map((p) => p.pageUrl)).toEqual(['https://a.example/1', 'https://a.example/2', 'https://a.example/3']);
    expect(r.products.every((p) => p.imageUrl === undefined)).toBe(true);
  });

  it('結果 0 件(visual_matches が無い・空)は ok で空', async () => {
    for (const body of [{ visual_matches: [] }, {}, { error: 'Google Lens hasn\'t returned any results for this query.' }]) {
      const { s } = make(fakeFetch({ body: UPLOAD_OK }, { body }));
      const r = await s.searchByImage(JPEG);
      expect(r).toMatchObject({ status: 'ok', products: [], calls: 2 });
    }
  });

  it('キー未設定は not_configured で、通信しない', async () => {
    const f = fakeFetch({ body: UPLOAD_OK }, { body: {} });
    const { s } = make(f, { key: null });
    expect(await s.searchByImage(JPEG)).toEqual({ status: 'not_configured', products: [], calls: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('月間上限に達していたら budget_exhausted(アップロード + 検索の 2 回分が残っていないときも)', async () => {
    const f = fakeFetch({ body: UPLOAD_OK }, { body: {} });
    const { s, store } = make(f, { limit: 5 });
    store.addMonthly(NOW, { serpapi: 4 });
    expect(await s.searchByImage(JPEG)).toEqual({ status: 'budget_exhausted', products: [], calls: 0 });
    expect(f.calls).toHaveLength(0);
    expect(store.monthly(NOW).serpapi).toBe(4);
  });

  it('アップロードの HTTP エラーは failed(detail)。検索はせず、アップロード分だけ数える', async () => {
    const f = fakeFetch({ ok: false, status: 429, body: {} }, { body: {} });
    const { s, store } = make(f);
    expect(await s.searchByImage(JPEG)).toEqual({ status: 'failed', products: [], calls: 1, detail: 'upload_http_429' });
    expect(f.calls).toHaveLength(1);
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('アップロードの応答に image_id が無ければ failed(upload_parse)', async () => {
    const { s } = make(fakeFetch({ body: { message: 'Image uploaded successfully.' } }, { body: {} }));
    expect(await s.searchByImage(JPEG)).toMatchObject({ status: 'failed', calls: 1, detail: 'upload_parse' });
  });

  it('通信失敗は failed(network)、検索の HTTP エラーは failed(http_ステータス)', async () => {
    const a = make(fakeFetch('throw', { body: {} }));
    expect(await a.s.searchByImage(JPEG)).toMatchObject({ status: 'failed', calls: 1, detail: 'upload_network' });
    const b = make(fakeFetch({ body: UPLOAD_OK }, 'throw'));
    expect(await b.s.searchByImage(JPEG)).toMatchObject({ status: 'failed', calls: 2, detail: 'network' });
    const c = make(fakeFetch({ body: UPLOAD_OK }, { ok: false, status: 500, body: {} }));
    expect(await c.s.searchByImage(JPEG)).toMatchObject({ status: 'failed', calls: 2, detail: 'http_500' });
  });

  it('不正な検索応答(visual_matches が配列でない)は failed(parse)', async () => {
    const { s } = make(fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: 'x' } }));
    expect(await s.searchByImage(JPEG)).toMatchObject({ status: 'failed', calls: 2, detail: 'parse' });
  });

  it('タイムアウトは failed(timeout)。再試行しない', async () => {
    const f = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as UploadFetchLike;
    const { s } = make(f, { uploadTimeoutMs: 10 });
    expect(await s.searchByImage(JPEG)).toMatchObject({ status: 'failed', calls: 1, detail: 'upload_timeout' });
  });

  it('アップロードは短い制限で打ち切られ、検索は長い制限で待つ(偽の時計)', async () => {
    jest.useFakeTimers();
    try {
      // 応答するまで指定ミリ秒かかる偽の fetch。signal が abort されたら reject する。
      const slow = (ms: number, body: unknown) =>
        new Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>((resolve, reject) => {
          const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => body }), ms);
          return t;
        });
      const f = ((url: string, init?: { signal?: AbortSignal }) => {
        const isUpload = url.startsWith('https://serpapi.com/image');
        const p = isUpload ? slow(1_000, UPLOAD_OK) : slow(30_000, { visual_matches: [row()] });
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          p.then(resolve, reject);
        });
      }) as unknown as UploadFetchLike;
      const { s } = make(f, { uploadTimeoutMs: 5_000, searchTimeoutMs: 45_000 });
      const result = s.searchByImage(JPEG);
      await jest.advanceTimersByTimeAsync(1_000); // アップロード完了
      await jest.advanceTimersByTimeAsync(30_000); // 検索は 5 秒を超えても待つ
      expect(await result).toMatchObject({ status: 'ok', calls: 2 });

      // アップロードが制限を超えると upload_timeout。
      const slowUpload = ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_res, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as UploadFetchLike;
      const b = make(slowUpload, { uploadTimeoutMs: 5_000, searchTimeoutMs: 45_000 });
      const r2 = b.s.searchByImage(new Uint8Array([7, 7]));
      await jest.advanceTimersByTimeAsync(5_000);
      expect(await r2).toMatchObject({ status: 'failed', calls: 1, detail: 'upload_timeout' });

      // 検索は長い制限(45 秒)で打ち切られ timeout。
      const hangSearch = ((url: string, init?: { signal?: AbortSignal }) =>
        url.startsWith('https://serpapi.com/image')
          ? Promise.resolve({ ok: true, status: 200, json: async () => UPLOAD_OK })
          : new Promise((_res, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            })) as unknown as UploadFetchLike;
      const c = make(hangSearch, { uploadTimeoutMs: 5_000, searchTimeoutMs: 45_000 });
      const r3 = c.s.searchByImage(new Uint8Array([8, 8]));
      await jest.advanceTimersByTimeAsync(44_999);
      let settled = false;
      void r3.then(() => (settled = true));
      await jest.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(await r3).toMatchObject({ status: 'failed', calls: 2, detail: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('同じ画像(ハッシュが同じ)は 2 回目をキャッシュから返し、通信も加算もしない', async () => {
    const f = fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: [row()] } });
    const { s, store } = make(f);
    await s.searchByImage(JPEG);
    const again = await s.searchByImage(new Uint8Array(JPEG));
    expect(again).toMatchObject({ status: 'ok', calls: 0 });
    expect(again.products).toHaveLength(1);
    expect(f.calls).toHaveLength(2);
    expect(store.monthly(NOW).serpapi).toBe(2);
    // 別の画像はキャッシュに当たらない。
    await s.searchByImage(new Uint8Array([9, 9, 9]));
    expect(f.calls).toHaveLength(4);
  });

  it('失敗した結果はキャッシュしない', async () => {
    const f = fakeFetch({ ok: false, status: 500, body: {} }, { body: {} });
    const { s } = make(f);
    await s.searchByImage(JPEG);
    await s.searchByImage(JPEG);
    expect(f.calls).toHaveLength(2);
  });

  it('上限の 80% に達したら onWarn を 1 度だけ呼ぶ(キーは含めない)', async () => {
    const warns: string[] = [];
    const { s, store } = make(fakeFetch({ body: UPLOAD_OK }, { body: { visual_matches: [] } }), {
      limit: 10,
      onWarn: (m) => warns.push(m),
    });
    store.addMonthly(NOW, { serpapi: 5 });
    await s.searchByImage(new Uint8Array([1])); // 6, 7
    expect(warns).toHaveLength(0);
    await s.searchByImage(new Uint8Array([2])); // 8 に達する
    await s.searchByImage(new Uint8Array([3])); // 残りが 2 回分に満たず、始めない
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('80%');
    expect(warns[0]).not.toContain('KEY');
  });
});
