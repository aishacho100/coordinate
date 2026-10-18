import type { DetectedItem, Product } from '@coordinate/shared';

import { sampleItem } from '../test-utils';
import type { ProductSearcher, SearchOutcome } from '../search/types';
import { Identifier } from './identifier';

const NOW = new Date('2026-10-18T03:00:00Z');
const product = (name: string, source = 'rakuten', imageUrl = 'https://thumbnail.image.rakuten.co.jp/a.jpg'): Product => ({
  source,
  productId: `${source}:${name}`,
  brand: '',
  name,
  imageUrl,
  fetchedAt: NOW.toISOString(),
});
const searcher = (outcomes: SearchOutcome[]): ProductSearcher & { queries: string[] } => {
  const s = {
    queries: [] as string[],
    async search(q: string) {
      s.queries.push(q);
      return outcomes[Math.min(s.queries.length - 1, outcomes.length - 1)]!;
    },
  };
  return s;
};
const ok = (products: Product[], calls = 1): SearchOutcome => ({ status: 'ok', products, calls });
const img = { data: new Uint8Array([1]), mediaType: 'image/jpeg' as const };
const usage = (i: number, o: number) => ({ inputTokens: i, outputTokens: o });

const make = (over: Partial<ConstructorParameters<typeof Identifier>[0]> = {}) =>
  new Identifier({
    queryGenerator: { generate: async () => ({ queries: ['q1', 'q2'], usage: usage(80, 20) }) },
    comparer: {
      compare: async (_i, cands) => ({
        judgements: cands.map((_, index) => ({ index, sameProduct: false, nameMatchesFeatures: false, similarity: 0.6, matched: ['色'], unconfirmed: ['型番'] })),
        usage: usage(900, 100),
      }),
    },
    serpapi: searcher([ok([product('g1', 'google_shopping')])]),
    rakuten: searcher([ok([product('r1')])]),
    maxSearchesPerProvider: 2,
    pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    serpapiCostPerSearchUsd: 0.025,
    now: () => NOW,
    ...over,
  });

describe('Identifier', () => {
  it('両方で検索して照合し、B を返す。使用量と概算費用を集計する(候補が少ないので各 2 回検索)', async () => {
    const r = await make().identify(img, sampleItem);
    expect(r.verdict).toBe('candidates');
    expect(r.level).toBe('low');
    expect(r.candidates.length).toBe(2);
    expect(r.searches).toEqual({ serpapi: 'ok', rakuten: 'ok' });
    expect(r.comparison).toBe('done');
    expect(r.usage).toEqual({ claude: usage(980, 120), serpapiSearches: 2, rakutenCalls: 2 });
    expect(r.estimatedCostUsd).toBeCloseTo((980 * 2 + 120 * 10) / 1e6 + 0.05, 6);
    expect(r.fetchedAt).toBe(NOW.toISOString());
  });

  it('候補が少なければ 2 つ目の検索語で追加検索する(最大 2 回まで)', async () => {
    const serp = searcher([ok([]), ok([product('g2', 'google_shopping')])]);
    const rak = searcher([ok([])]);
    await make({ serpapi: serp, rakuten: rak }).identify(img, sampleItem);
    expect(serp.queries).toEqual(['q1', 'q2']);
    expect(rak.queries).toEqual(['q1', 'q2']);
  });

  it('十分な候補があれば追加検索しない', async () => {
    const many = Array.from({ length: 5 }, (_, i) => product(`g${i}`, 'google_shopping'));
    const serp = searcher([ok(many)]);
    const rak = searcher([ok(many.map((p) => ({ ...p, source: 'rakuten', productId: `r-${p.productId}` })))]);
    await make({ serpapi: serp, rakuten: rak }).identify(img, sampleItem);
    expect(serp.queries).toEqual(['q1']);
  });

  it('片方が使えなくても、もう一方の結果で続け、状態を返す', async () => {
    const r = await make({ serpapi: searcher([{ status: 'budget_exhausted', products: [], calls: 0 }]) }).identify(img, sampleItem);
    expect(r.searches).toEqual({ serpapi: 'budget_exhausted', rakuten: 'ok' });
    expect(r.candidates.length).toBe(1);
  });

  it('1 つ目が ok で 2 つ目が failed なら、全体の status は ok のまま', async () => {
    const serp = searcher([ok([product('g1', 'google_shopping')]), { status: 'failed', products: [], calls: 1 }]);
    const r = await make({ serpapi: serp }).identify(img, sampleItem);
    expect(serp.queries).toEqual(['q1', 'q2']);
    expect(r.searches.serpapi).toBe('ok');
    expect(r.usage.serpapiSearches).toBe(2);
    expect(r.candidates.length).toBe(2);
  });

  it('両方使えなければ SearchUnavailableError', async () => {
    const dead = searcher([{ status: 'not_configured', products: [], calls: 0 }]);
    await expect(make({ serpapi: dead, rakuten: dead }).identify(img, sampleItem)).rejects.toThrow('SearchUnavailableError');
  });

  it('候補が 0 件なら C。照合の Claude は呼ばない', async () => {
    let called = false;
    const r = await make({
      serpapi: searcher([ok([])]),
      rakuten: searcher([ok([])]),
      comparer: { compare: async () => ((called = true), { judgements: [], usage: usage(0, 0) }) },
    }).identify(img, sampleItem);
    expect(r.verdict).toBe('unidentified');
    expect(r.level).toBe('unidentified');
    expect(called).toBe(false);
  });

  it('照合が失敗したら、候補を「未照合」として B で返す(A にはしない)', async () => {
    const brandItem: DetectedItem = { ...sampleItem, brandCandidates: [{ name: 'Nike', score: 0.9 }] };
    const r = await make({
      comparer: {
        compare: async () => {
          throw new Error('x');
        },
      },
    }).identify(img, brandItem);
    expect(r.comparison).toBe('failed');
    expect(r.verdict).toBe('candidates');
    expect(r.candidates[0]?.unconfirmed).toContain('画像との照合ができませんでした');
    expect(r.candidates[0]?.matchType).toBe('similar');
  });

  it('検索語の生成が失敗したら例外(検索は一度も行わない)', async () => {
    const serp = searcher([ok([])]);
    await expect(
      make({
        serpapi: serp,
        queryGenerator: {
          generate: async () => {
            throw new Error('x');
          },
        },
      }).identify(img, sampleItem),
    ).rejects.toThrow();
    expect(serp.queries).toHaveLength(0);
  });

  it('同じ商品(同じ source と productId)は 1 件にまとめる', async () => {
    const dup = product('same');
    const r = await make({ serpapi: searcher([ok([])]), rakuten: searcher([ok([dup, dup])]) }).identify(img, sampleItem);
    expect(r.candidates).toHaveLength(1);
  });
});
