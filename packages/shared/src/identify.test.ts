import { ApiErrorCodeSchema } from './analyze';
import { IdentifyResponseSchema, verdictToLevel } from './identify';

const product = {
  source: 'google_shopping',
  productId: 'p1',
  brand: '',
  name: 'NIKE Air Force 1',
  pageUrl: 'https://www.google.com/search?ibp=oshop&q=x',
  seller: 'Nike Japan',
  imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:a',
  price: { amount: 16500, currency: 'JPY', kind: 'market', fetchedAt: '2026-10-18T00:00:00.000Z' },
  fetchedAt: '2026-10-18T00:00:00.000Z',
};

const base = {
  itemId: 'item_1',
  verdict: 'candidates',
  level: 'low',
  rationale: '候補は見つかりましたが、同じ商品とは確認できませんでした',
  candidates: [{ product, matchScore: 0.6, matchType: 'similar', matched: ['色'], unconfirmed: ['型番'] }],
  searches: { serpapi: 'ok', rakuten: 'not_configured' },
  comparison: 'done',
  queries: ['nike air force 1 白'],
  usage: { claude: { inputTokens: 100, outputTokens: 50 }, serpapiSearches: 1, rakutenCalls: 0 },
  estimatedCostUsd: null,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  timings: { total: 1200 },
};

describe('IdentifyResponseSchema', () => {
  it('正しい応答を受け付ける', () => {
    expect(IdentifyResponseSchema.safeParse(base).success).toBe(true);
  });
  it('候補は最大 5 件', () => {
    const c = base.candidates[0]!;
    expect(IdentifyResponseSchema.safeParse({ ...base, candidates: Array(6).fill(c) }).success).toBe(false);
  });
  it('未知の判定は拒否する', () => {
    expect(IdentifyResponseSchema.safeParse({ ...base, verdict: 'sure' }).success).toBe(false);
  });
});

describe('verdictToLevel', () => {
  it('A は high、B はブランド採用済みなら medium、なければ low、C は unidentified', () => {
    expect(verdictToLevel('identified', false)).toBe('high');
    expect(verdictToLevel('candidates', true)).toBe('medium');
    expect(verdictToLevel('candidates', false)).toBe('low');
    expect(verdictToLevel('unidentified', true)).toBe('unidentified');
  });
});

describe('ApiErrorCodeSchema', () => {
  it('商品特定で使うコードを含む', () => {
    for (const c of ['search_unavailable', 'identify_failed', 'quota_exceeded', 'invalid_request']) {
      expect(ApiErrorCodeSchema.safeParse(c).success).toBe(true);
    }
  });
});
