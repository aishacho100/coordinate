import type { CropRect } from '@coordinate/layout';
import type { IdentifyResponse } from '@coordinate/shared';

import type { ResultItem } from '@/features/analysis/analysis-reducer';
import { itemsToLabelInputs } from '@/features/analysis/items-to-labels';

const FETCHED = '2026-10-18T00:00:00.000Z';
const full: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const ids = () => 'l_1';

type Cand = IdentifyResponse['candidates'][number];
const candidate = (productId: string, name: string, brand: string, price?: { amount: number; currency: string }): Cand => ({
  product: {
    source: 'google_shopping',
    productId,
    brand,
    name,
    fetchedAt: FETCHED,
    ...(price ? { price: { ...price, kind: 'market' as const, fetchedAt: FETCHED } } : {}),
  },
  matchScore: 0.8,
  matchType: 'identical',
  matched: [],
  unconfirmed: [],
});

const itemWith = (cands: Cand[], pick: string | null, over: Partial<ResultItem> = {}): ResultItem => ({
  id: 'a',
  categoryId: 'sneakers',
  brand: '',
  box: { x: 0.2, y: 0.3, w: 0.2, h: 0.2 },
  origin: 'ai',
  level: 'medium',
  detected: null,
  identify: {
    status: 'done',
    response: {
      itemId: 'a',
      verdict: 'candidates',
      level: 'medium',
      rationale: '',
      candidates: cands,
      searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
      comparison: 'done',
      queries: [],
      usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 0, rakutenCalls: 0, lensSearches: 0 },
      estimatedCostUsd: null,
      fetchedAt: FETCHED,
      timings: { total: 1 },
    },
  },
  chosen: pick ? { source: 'google_shopping', productId: pick } : null,
  ...over,
});

const labelOf = (it: ResultItem) => itemsToLabelInputs([it], full, ids)[0];

describe('itemsToLabelInputs: 選んだ候補', () => {
  it('選んだ候補の短い商品名と JPY の値段を入れる', () => {
    const it = itemWith(
      [candidate('p1', '【楽天市場】NIKE エアフォース1 メンズ CJ4864-657 送料無料', 'NIKE', { amount: 14300, currency: 'JPY' })],
      'p1',
      { brand: 'NIKE' },
    );
    expect(labelOf(it)).toMatchObject({ brand: 'NIKE', name: 'エアフォース1 CJ4864-657', price: '¥14,300' });
  });

  it('未選択ならカテゴリ名のまま、値段は入れない', () => {
    const l = labelOf(itemWith([candidate('p1', 'NIKE Air Force 1', 'NIKE', { amount: 14300, currency: 'JPY' })], null));
    expect(l?.name).toBe('スニーカー');
    expect(l?.price).toBeUndefined();
  });

  it('JPY 以外・価格なしでは値段を入れない', () => {
    expect(labelOf(itemWith([candidate('p1', 'Air Force 1', '', { amount: 99, currency: 'USD' })], 'p1'))?.price).toBeUndefined();
    expect(labelOf(itemWith([candidate('p1', 'Air Force 1', '')], 'p1'))?.price).toBeUndefined();
  });

  it('ブランドは item.brand を優先し、空のときだけ候補の brand で補う', () => {
    expect(labelOf(itemWith([candidate('p1', 'Air Force 1', 'ADIDAS')], 'p1', { brand: 'NIKE' }))?.brand).toBe('NIKE');
    expect(labelOf(itemWith([candidate('p1', 'Air Force 1', 'ADIDAS')], 'p1', { brand: ' ' }))?.brand).toBe('ADIDAS');
    expect(labelOf(itemWith([candidate('p1', 'Air Force 1', '')], 'p1'))?.brand).toBe('');
  });

  it('短くした結果が空ならカテゴリ名にする', () => {
    expect(labelOf(itemWith([candidate('p1', '【楽天市場】送料無料', '')], 'p1'))?.name).toBe('スニーカー');
  });

  it('選んだ候補が結果に見つからなければ何も入れない', () => {
    expect(labelOf(itemWith([candidate('p1', 'Air Force 1', '')], 'zzz'))?.name).toBe('スニーカー');
  });
});
