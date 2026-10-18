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
    lens: null,
    prepareLens: async (d) => d,
    now: () => NOW,
    ...over,
  });

describe('Identifier', () => {
  it('両方で検索して照合し、B を返す。使用量と概算費用を集計する(候補が少ないので各 2 回検索)', async () => {
    const r = await make().identify(img, sampleItem);
    expect(r.verdict).toBe('candidates');
    expect(r.level).toBe('low');
    expect(r.candidates.length).toBe(2);
    expect(r.searches).toEqual({ serpapi: 'ok', rakuten: 'ok', lens: 'not_consented' });
    expect(r.comparison).toBe('done');
    expect(r.usage).toEqual({ claude: usage(980, 120), serpapiSearches: 2, rakutenCalls: 2, lensSearches: 0 });
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
    expect(r.searches).toEqual({ serpapi: 'budget_exhausted', rakuten: 'ok', lens: 'not_consented' });
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
  describe('Lens(画像検索)', () => {
    const lensProduct = (n: string, over: Partial<Product> = {}): Product => ({
      ...product(n, 'google_lens', `https://encrypted-tbn0.gstatic.com/${n}.jpg`),
      pageUrl: `https://shop.example/${n}`,
      ...over,
    });
    const fakeLens = (outcome: SearchOutcome) => {
      const l = {
        calls: 0,
        async searchByImage(_j: Uint8Array) {
          l.calls += 1;
          return outcome;
        },
      };
      return l;
    };
    const capture = () => {
      const c = { passed: [] as Product[] };
      const comparer = {
        compare: async (_i: unknown, cands: Product[]) => {
          c.passed = cands;
          return { judgements: [], usage: usage(1, 1) };
        },
      };
      return { c, comparer };
    };

    it('同意が無ければ Lens を呼ばず not_consented。テキスト検索は行う', async () => {
      const lens = fakeLens(ok([lensProduct('a')], 2));
      const serp = searcher([ok([product('g1', 'google_shopping')])]);
      const r = await make({ lens, serpapi: serp }).identify(img, sampleItem, { consent: false });
      expect(lens.calls).toBe(0);
      expect(r.searches.lens).toBe('not_consented');
      expect(serp.queries.length).toBeGreaterThan(0);
      expect(r.usage.lensSearches).toBe(0);
    });

    it('同意ありでも Lens が未設定(null)なら not_configured', async () => {
      const r = await make({ lens: null }).identify(img, sampleItem, { consent: true });
      expect(r.searches.lens).toBe('not_configured');
    });

    it('同意ありで使える候補が 3 件以上なら、テキスト検索は呼ばない。Lens の候補が先頭', async () => {
      const lens = fakeLens(ok([lensProduct('a'), lensProduct('b'), lensProduct('c')], 2));
      const serp = searcher([ok([product('g1', 'google_shopping')])]);
      const rak = searcher([ok([product('r1')])]);
      const { c, comparer } = capture();
      const r = await make({ lens, serpapi: serp, rakuten: rak, comparer }).identify(img, sampleItem, { consent: true });
      expect(serp.queries).toHaveLength(0);
      expect(rak.queries).toHaveLength(0);
      expect(c.passed.map((p) => p.source)).toEqual(['google_lens', 'google_lens', 'google_lens']);
      expect(r.searches.lens).toBe('ok');
      expect(r.usage).toMatchObject({ serpapiSearches: 0, rakutenCalls: 0, lensSearches: 2 });
      expect(r.estimatedCostUsd).toBeCloseTo(((80 + 1) * 2 + (20 + 1) * 10) / 1e6 + 2 * 0.025, 6);
    });

    it('商品ページか画像が無い行は使える候補に数えない(3 件未満ならテキスト検索も行う)', async () => {
      const lens = fakeLens(
        ok([lensProduct('a'), lensProduct('b'), lensProduct('c', { pageUrl: undefined }), lensProduct('d', { imageUrl: undefined })], 2),
      );
      const serp = searcher([ok([product('g1', 'google_shopping')])]);
      await make({ lens, serpapi: serp }).identify(img, sampleItem, { consent: true });
      expect(serp.queries.length).toBeGreaterThan(0);
    });

    it('使える候補が 3 件未満なら、テキスト検索も行い合成する(重複除去・最大 12 件・Lens の先頭)', async () => {
      const lens = fakeLens(
        ok([lensProduct('a'), lensProduct('a'), lensProduct('b', { productId: 'x', pageUrl: 'https://shop.example/a' })], 2),
      );
      const g = Array.from({ length: 20 }, (_, i) => product(`g${i}`, 'google_shopping'));
      const { c, comparer } = capture();
      await make({ lens, serpapi: searcher([ok(g)]), rakuten: searcher([ok([product('r1')])]), comparer }).identify(img, sampleItem, {
        consent: true,
      });
      expect(c.passed).toHaveLength(12);
      expect(c.passed[0]?.source).toBe('google_lens');
      expect(c.passed.filter((p) => p.source === 'google_lens')).toHaveLength(1);
    });

    it('Lens が 8 件を超えても 8 件まで', async () => {
      const many = Array.from({ length: 12 }, (_, i) => lensProduct(`m${i}`));
      const { c, comparer } = capture();
      await make({ lens: fakeLens(ok(many, 2)), comparer }).identify(img, sampleItem, { consent: true });
      expect(c.passed).toHaveLength(8);
    });

    it.each(['failed', 'budget_exhausted', 'not_configured'] as const)('Lens が %s ならテキスト検索へ', async (status) => {
      const lens = fakeLens({ status, products: [], calls: status === 'failed' ? 1 : 0, detail: 'upload_http_500' });
      const r = await make({ lens }).identify(img, sampleItem, { consent: true });
      expect(r.searches.lens).toBe(status);
      expect(r.candidates.length).toBe(2);
      expect(r.usage.lensSearches).toBe(status === 'failed' ? 1 : 0);
    });

    it('Lens もテキスト検索も使えなければ SearchUnavailableError', async () => {
      const dead = searcher([{ status: 'failed', products: [], calls: 1 }]);
      const lens = fakeLens({ status: 'failed', products: [], calls: 1 });
      await expect(make({ lens, serpapi: dead, rakuten: dead }).identify(img, sampleItem, { consent: true })).rejects.toThrow(
        'SearchUnavailableError',
      );
    });

    it('Lens が ok で 0 件、テキストが全て使えないなら、例外にせず C', async () => {
      const dead = searcher([{ status: 'failed', products: [], calls: 1 }]);
      const r = await make({ lens: fakeLens(ok([], 2)), serpapi: dead, rakuten: dead }).identify(img, sampleItem, { consent: true });
      expect(r.verdict).toBe('unidentified');
      expect(r.searches.lens).toBe('ok');
    });

    it('prepareLens が例外なら lens は failed でテキスト検索へ。Lens は呼ばない', async () => {
      const lens = fakeLens(ok([lensProduct('a')], 2));
      const seen: string[] = [];
      const r = await make({
        lens,
        prepareLens: async () => {
          throw new Error('bad image');
        },
      }).identify(img, sampleItem, { consent: true, onSearchFailure: (p, d) => seen.push(`${p}:${d}`) });
      expect(lens.calls).toBe(0);
      expect(r.searches.lens).toBe('failed');
      expect(seen).toEqual(['lens:prepare']);
      expect(r.candidates.length).toBe(2);
    });

    it('Lens の failed を onSearchFailure に lens として通知する', async () => {
      const seen: string[] = [];
      await make({ lens: fakeLens({ status: 'failed', products: [], calls: 1, detail: 'upload_http_429' }) }).identify(img, sampleItem, {
        consent: true,
        onSearchFailure: (p, d) => seen.push(`${p}:${d}`),
      });
      expect(seen).toEqual(['lens:upload_http_429']);
    });

    it('Lens に渡すのは prepareLens の出力', async () => {
      let got: Uint8Array | undefined;
      const lens = { searchByImage: async (j: Uint8Array) => ((got = j), ok([], 2)) };
      await make({ lens, prepareLens: async () => new Uint8Array([9, 9]) }).identify(img, sampleItem, { consent: true });
      expect(Array.from(got ?? [])).toEqual([9, 9]);
    });
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
