import type { MessagesClient } from '../detector/claude-vision-detector';
import type { Product } from '@coordinate/shared';

import type { FetchedImage } from '../search/fetch-image';
import { Comparer as RealComparer, ComparisonError } from './comparer';

const fetched: FetchedImage = { data: new Uint8Array([9, 8, 7]), mediaType: 'image/webp' };
/** 取得は偽物。urls に呼ばれた URL を残す。 */
const fakeFetch = (result: FetchedImage | null | ((url: string) => FetchedImage | null) = fetched) => {
  const f = (async (url: string) => {
    f.urls.push(url);
    return typeof result === 'function' ? result(url) : result;
  }) as ((url: string) => Promise<FetchedImage | null>) & { urls: string[] };
  f.urls = [];
  return f;
};
class Comparer extends RealComparer {
  constructor(c: MessagesClient, m: string, e: 'low', f: (url: string) => Promise<FetchedImage | null> = fakeFetch()) {
    super(c, m, e, f);
  }
}

const p = (name: string, imageUrl?: string): Product => ({
  source: 'rakuten',
  productId: name,
  brand: '',
  name,
  ...(imageUrl ? { imageUrl } : {}),
  fetchedAt: '2026-10-18T00:00:00.000Z',
});
const reply = (obj: unknown, over: Record<string, unknown> = {}) =>
  ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn', model: 'm', usage: { input_tokens: 900, output_tokens: 120 }, ...over }) as never;
const client = (r: unknown) => {
  const c = {
    calls: [] as any[],
    messages: {
      create: async (x: unknown) => {
        c.calls.push(x);
        return r as never;
      },
    },
  };
  return c as MessagesClient & { calls: any[] };
};
const img = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' as const };
const row = (index: number, over: Record<string, unknown> = {}) => ({
  index,
  same_product: false,
  name_matches_features: false,
  similarity: 0.5,
  matched: ['色'],
  unconfirmed: ['型番'],
  ...over,
});

describe('Comparer', () => {
  it('切り抜きと、サーバーが取得した候補の画像(base64)を渡し、判断を返す', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true, similarity: 0.9 })] }));
    const f = fakeFetch();
    const out = await new Comparer(c, 'm', 'low', f).compare(img, [p('a', 'https://thumbnail.image.rakuten.co.jp/a.jpg')]);
    expect(out.judgements[0]).toMatchObject({ index: 0, sameProduct: true, nameMatchesFeatures: true, similarity: 0.9 });
    expect(out.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
    const content = c.calls[0].messages[0].content;
    const images = content.filter((b: any) => b.type === 'image');
    expect(images).toHaveLength(2);
    expect(images[1].source).toEqual({ type: 'base64', media_type: 'image/webp', data: Buffer.from(fetched.data).toString('base64') });
    expect(images.every((b: any) => b.source.type === 'base64')).toBe(true);
    expect(f.urls).toEqual(['https://thumbnail.image.rakuten.co.jp/a.jpg']);
  });
  it('画像が無い候補は同一とは判断させない(sameProduct を false に固定)', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true })] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('no-image')]);
    expect(out.judgements[0]?.sameProduct).toBe(false);
    expect(c.calls[0].messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(1);
  });
  it('画像を取得できなかった候補は「(no image for this candidate)」とし、同一とも判断させない。URL は Claude に渡さない', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true })] }));
    const out = await new Comparer(c, 'm', 'low', fakeFetch(null)).compare(img, [p('x', 'https://serpapi.com/images/url/a.webp')]);
    const content = c.calls[0].messages[0].content;
    expect(content.filter((b: any) => b.type === 'image')).toHaveLength(1);
    expect(content.some((b: any) => b.type === 'text' && b.text === '(no image for this candidate)')).toBe(true);
    expect(JSON.stringify(c.calls[0])).not.toContain('serpapi.com');
    expect(out.judgements[0]?.sameProduct).toBe(false);
  });
  it('画像 URL が無い候補は取得を試みない。取得できた候補と混在しても index は保たれる', async () => {
    const c = client(reply({ results: [row(0, { same_product: true }), row(1, { same_product: true })] }));
    const f = fakeFetch((u) => (u.includes('ok') ? fetched : null));
    const out = await new Comparer(c, 'm', 'low', f).compare(img, [
      p('ng', 'https://serpapi.com/images/url/ng.webp'),
      p('ok', 'https://serpapi.com/images/url/ok.webp'),
      p('none'),
    ]);
    expect(f.urls).toHaveLength(2);
    expect(out.judgements.map((j) => j.sameProduct)).toEqual([false, true]);
  });
  it('画像の取得は同時に 4 件まで', async () => {
    let cur = 0;
    let max = 0;
    const f = async () => {
      cur++;
      max = Math.max(max, cur);
      await new Promise((r) => setTimeout(r, 10));
      cur--;
      return fetched;
    };
    const c = client(reply({ results: [] }));
    const cands = Array.from({ length: 8 }, (_, i) => p(`n${i}`, `https://serpapi.com/images/url/${i}.webp`));
    await new Comparer(c, 'm', 'low', f).compare(img, cands);
    expect(max).toBe(4);
  });
  it('取得処理が例外を投げても、その候補は画像なしとして続行する', async () => {
    const c = client(reply({ results: [row(0, { same_product: true })] }));
    const f = async (): Promise<FetchedImage | null> => {
      throw new Error('x');
    };
    const out = await new Comparer(c, 'm', 'low', f).compare(img, [p('a', 'https://serpapi.com/images/url/a.webp')]);
    expect(out.judgements[0]?.sameProduct).toBe(false);
  });
  it('範囲外の index と不正な値を捨てる', async () => {
    const c = client(reply({ results: [row(5), row(0, { similarity: 7 }), row(0)] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('a')]);
    expect(out.judgements).toHaveLength(1);
  });
  it('拒否・打ち切り・JSON でない出力は ComparisonError', async () => {
    for (const r of [reply({}, { stop_reason: 'refusal' }), reply({}, { stop_reason: 'max_tokens' }), { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }]) {
      await expect(new Comparer(client(r), 'm', 'low').compare(img, [p('a')])).rejects.toThrow('ComparisonError');
    }
  });
  it('応答を受け取ったあとの検証失敗では、取得済みの usage を例外に載せる', async () => {
    const bad = { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 3 } };
    const err = await new Comparer(client(bad), 'm', 'low').compare(img, [p('a')]).catch((e) => e);
    expect(err).toBeInstanceOf(ComparisonError);
    expect(err.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });
  it('候補が無ければ Claude を呼ばない', async () => {
    const c = client(reply({ results: [] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, []);
    expect(out.judgements).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });
  it('timeoutMs を渡されたら、Claude の呼び出しオプション(timeout)に使う。無ければオプションなし', async () => {
    const seen: unknown[] = [];
    const c = {
      messages: {
        create: async (_x: unknown, o?: unknown) => (seen.push(o), reply({ results: [row(0)] })),
      },
    } as unknown as MessagesClient;
    await new Comparer(c, 'm', 'low').compare(img, [p('a')], { timeoutMs: 12_345 });
    await new Comparer(c, 'm', 'low').compare(img, [p('a')]);
    expect(seen).toEqual([{ timeout: 12_345 }, undefined]);
  });
});
