import type { MessagesClient } from '../detector/claude-vision-detector';
import type { Product } from '@coordinate/shared';

import { Comparer } from './comparer';

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
  it('切り抜きと候補の画像 URL を渡し、判断を返す', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true, similarity: 0.9 })] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('a', 'https://thumbnail.image.rakuten.co.jp/a.jpg')]);
    expect(out.judgements[0]).toMatchObject({ index: 0, sameProduct: true, nameMatchesFeatures: true, similarity: 0.9 });
    expect(out.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
    const content = c.calls[0].messages[0].content;
    expect(content.filter((b: any) => b.type === 'image')).toHaveLength(2);
    expect(content.some((b: any) => b.type === 'image' && b.source.type === 'url' && b.source.url.includes('rakuten'))).toBe(true);
  });
  it('画像が無い候補は同一とは判断させない(sameProduct を false に固定)', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true })] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('no-image')]);
    expect(out.judgements[0]?.sameProduct).toBe(false);
    expect(c.calls[0].messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(1);
  });
  it('許可されていないドメインの画像は Claude に渡さず、同一とも判断させない', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true })] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('evil', 'https://evil.example.com/a.jpg')]);
    expect(c.calls[0].messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(1);
    expect(JSON.stringify(c.calls[0])).not.toContain('evil.example.com');
    // 画像 URL はあるが Claude は見ていないため、同一とは扱わない。
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
  it('候補が無ければ Claude を呼ばない', async () => {
    const c = client(reply({ results: [] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, []);
    expect(out.judgements).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });
});
