import type { DetectedItem, Product, Usage } from '@coordinate/shared';

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
    expect(rak.queries).toEqual(['q2', 'q1']);
  });

  it('SerpApi には具体的な語から、楽天には一般的な語から(逆順で)渡す', async () => {
    const serp = searcher([ok([])]);
    const rak = searcher([ok([])]);
    await make({
      serpapi: serp,
      rakuten: rak,
      queryGenerator: { generate: async () => ({ queries: ['具体', '中間', '一般'], usage: usage(1, 1) }) },
      maxSearchesPerProvider: 2,
    }).identify(img, sampleItem);
    expect(serp.queries).toEqual(['具体', '中間']);
    expect(rak.queries).toEqual(['一般', '中間']);
  });

  it('照合に渡す候補は最大 12 件。SerpApi を最大 8 件、楽天を最大 4 件', async () => {
    const g = Array.from({ length: 20 }, (_, i) => product(`g${i}`, 'google_shopping'));
    const r = Array.from({ length: 10 }, (_, i) => product(`r${i}`));
    let passed: Product[] = [];
    await make({
      serpapi: searcher([ok(g)]),
      rakuten: searcher([ok(r)]),
      comparer: {
        compare: async (_i, cands) => {
          passed = cands;
          return { judgements: [], usage: usage(1, 1) };
        },
      },
    }).identify(img, sampleItem);
    expect(passed).toHaveLength(12);
    expect(passed.filter((p) => p.source === 'google_shopping')).toHaveLength(8);
    expect(passed.filter((p) => p.source === 'rakuten')).toHaveLength(4);
  });

  it('楽天が少ないときは、SerpApi の残りで 12 件まで埋める', async () => {
    const g = Array.from({ length: 20 }, (_, i) => product(`g${i}`, 'google_shopping'));
    let passed: Product[] = [];
    await make({
      serpapi: searcher([ok(g)]),
      rakuten: searcher([ok([product('r0')])]),
      comparer: {
        compare: async (_i, cands) => {
          passed = cands;
          return { judgements: [], usage: usage(1, 1) };
        },
      },
    }).identify(img, sampleItem);
    expect(passed).toHaveLength(12);
    expect(passed.filter((p) => p.source === 'rakuten')).toHaveLength(1);
    expect(passed.filter((p) => p.source === 'google_shopping')).toHaveLength(11);
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

  it('照合が失敗したときは、ブランドを読めていても level は low に固定する', async () => {
    const brandItem: DetectedItem = {
      ...sampleItem,
      appearance: { ...sampleItem.appearance, visibleText: ['NIKE'] },
      brandCandidates: [{ name: 'Nike', score: 0.9 }],
    };
    const r = await make({
      comparer: {
        compare: async () => {
          throw new Error('x');
        },
      },
    }).identify(img, brandItem);
    expect(r.comparison).toBe('failed');
    expect(r.level).toBe('low');
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
  describe('ブランドの再検証(クライアントの申告を信用しない)', () => {
    const allMatchComparer = {
      compare: async (_i: unknown, cands: Product[]) => ({
        judgements: cands.map((_, index) => ({ index, sameProduct: true, nameMatchesFeatures: true, similarity: 0.95, matched: ['ロゴ'], unconfirmed: [] })),
        usage: usage(900, 100),
      }),
    };
    const nike = (over: Partial<DetectedItem['appearance']>): DetectedItem => ({
      ...sampleItem,
      appearance: { ...sampleItem.appearance, ...over },
      brandCandidates: [{ name: 'Nike', score: 0.9 }],
    });
    const run = (item: DetectedItem) =>
      make({ comparer: allMatchComparer, serpapi: searcher([ok([])]), rakuten: searcher([ok([product('NIKE エアフォース1')])]) }).identify(img, item);

    it('visibleText が空でブランド候補だけある item は、他の条件がそろっても A にならず、level も low', async () => {
      const r = await run(nike({ visibleText: [] }));
      expect(r.verdict).toBe('candidates');
      expect(r.level).toBe('low');
    });

    it('visibleText にブランドが語として読み取れていれば A になる', async () => {
      const r = await run(nike({ visibleText: ['NIKE'] }));
      expect(r.verdict).toBe('identified');
      expect(r.level).toBe('high');
    });

    it('visibleText に無関係な文字しか無ければ A にならない', async () => {
      const r = await run(nike({ visibleText: ['SALE'] }));
      expect(r.verdict).toBe('candidates');
    });
  });
  describe('onSearchFailure(検索の失敗理由)', () => {
    it('failed の検索元と detail を通知する(失敗以外は通知しない)', async () => {
      const seen: string[] = [];
      const serp = searcher([{ status: 'failed', products: [], calls: 1, detail: 'http_429' }]);
      await make({ serpapi: serp }).identify(img, sampleItem, {
        onSearchFailure: (provider, detail) => seen.push(`${provider}:${detail}`),
      });
      expect(seen).toEqual(['serpapi:http_429']);
    });
    it('detail が無い失敗は unknown、通知側の例外は結果を妨げない', async () => {
      const rak = searcher([{ status: 'failed', products: [], calls: 1 }]);
      const r = await make({ rakuten: rak }).identify(img, sampleItem, {
        onSearchFailure: () => {
          throw new Error('x');
        },
      });
      expect(r.searches.rakuten).toBe('failed');
    });
  });
  describe('onUsage(失敗した処理の使用量も計上する)', () => {
    it('検索が両方失敗して 503 相当になっても、検索語生成のトークンを通知する', async () => {
      const dead = searcher([{ status: 'failed', products: [], calls: 1 }]);
      const seen: Usage[] = [];
      await expect(
        make({ serpapi: dead, rakuten: dead }).identify(img, sampleItem, { onUsage: (u) => seen.push(u) }),
      ).rejects.toThrow('SearchUnavailableError');
      expect(seen).toEqual([usage(80, 20)]);
    });

    it('成功時は、検索語生成と照合のそれぞれを 1 回ずつ通知する', async () => {
      const seen: Usage[] = [];
      await make().identify(img, sampleItem, { onUsage: (u) => seen.push(u) });
      expect(seen).toEqual([usage(80, 20), usage(900, 100)]);
    });

    it('照合が検証失敗(usage 付き)で例外になっても、その usage を通知し、結果の使用量にも含める', async () => {
      const seen: Usage[] = [];
      const err = Object.assign(new Error('ComparisonError'), { usage: usage(500, 50) });
      const r = await make({
        comparer: {
          compare: async () => {
            throw err;
          },
        },
      }).identify(img, sampleItem, { onUsage: (u) => seen.push(u) });
      expect(seen).toEqual([usage(80, 20), usage(500, 50)]);
      expect(r.comparison).toBe('failed');
      expect(r.usage.claude).toEqual(usage(580, 70));
    });

    it('検索語生成が検証失敗(usage 付き)で例外になっても、その usage を通知する', async () => {
      const seen: Usage[] = [];
      const err = Object.assign(new Error('QueryGenerationError'), { usage: usage(60, 10) });
      await expect(
        make({
          queryGenerator: {
            generate: async () => {
              throw err;
            },
          },
        }).identify(img, sampleItem, { onUsage: (u) => seen.push(u) }),
      ).rejects.toThrow();
      expect(seen).toEqual([usage(60, 10)]);
    });

    it('onUsage 自体が例外を投げても、結果の返却を妨げない', async () => {
      const r = await make().identify(img, sampleItem, {
        onUsage: () => {
          throw new Error('boom');
        },
      });
      expect(r.verdict).toBe('candidates');
    });
  });
});
