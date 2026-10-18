import type { AnalyzeResponse, DetectedItem, IdentifyResponse } from '@coordinate/shared';

import { analysisReducer, initialAnalysisState, type AnalysisAction, type AnalysisState } from '@/features/analysis/analysis-reducer';

const det = (id: string): DetectedItem => ({
  id,
  categoryId: 'tshirt',
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
  appearance: { colors: [], visibleText: [] },
  brandCandidates: [],
  candidates: [],
  confidence: { detection: 0.9, category: 0.9, brand: null, model: null, variant: null, price: null },
  level: 'unidentified',
  reviewState: 'auto',
  rationale: '',
  modelVersion: 'test',
});

const run = (actions: AnalysisAction[], from: AnalysisState = initialAnalysisState) =>
  actions.reduce(analysisReducer, from);

const base: AnalysisState = run([
  {
    type: 'succeeded',
    response: {
      items: [det('a')],
      quality: { ok: true, issues: [] },
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
      timings: { quality: 1, detect: 1, total: 2 },
    } as AnalyzeResponse,
  },
]);

const FETCHED = '2026-10-18T00:00:00.000Z';

const responseOf = (verdict: IdentifyResponse['verdict'], ids: string[]): IdentifyResponse => ({
  itemId: 'a',
  verdict,
  level: 'medium',
  rationale: '',
  candidates: ids.map((productId) => ({
    product: { source: 'google_shopping', productId, brand: 'NIKE', name: `商品 ${productId}`, fetchedAt: FETCHED },
    matchScore: 0.8,
    matchType: 'identical' as const,
    matched: [],
    unconfirmed: [],
  })),
  searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
  comparison: 'done',
  queries: [],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 0, lensSearches: 0 },
  estimatedCostUsd: null,
  fetchedAt: FETCHED,
  timings: { total: 1 },
});

const succeed = (verdict: IdentifyResponse['verdict'], ids: string[]): AnalysisAction => ({
  type: 'identifySucceeded',
  id: 'a',
  response: responseOf(verdict, ids),
});
const toggle = (productId: string): AnalysisAction => ({
  type: 'toggleCandidate',
  id: 'a',
  source: 'google_shopping',
  productId,
});
const choiceOf = (s: AnalysisState) => {
  if (s.status !== 'done') throw new Error('done ではありません');
  return s.items[0]?.chosen ?? null;
};
const P = (productId: string) => ({ source: 'google_shopping', productId });

describe('選んだ候補', () => {
  it('最初は何も選んでいない', () => {
    expect(choiceOf(base)).toBeNull();
  });

  it('verdict が identified のときだけ、先頭の候補を自動で選ぶ', () => {
    expect(choiceOf(run([succeed('identified', ['p1', 'p2'])], base))).toEqual(P('p1'));
    expect(choiceOf(run([succeed('candidates', ['p1', 'p2'])], base))).toBeNull();
    expect(choiceOf(run([succeed('unidentified', [])], base))).toBeNull();
  });

  it('候補をタップすると選択し、別の候補で付け替え、もう一度タップすると解除する(dirty になる)', () => {
    const ok = run([succeed('candidates', ['p1', 'p2'])], base);
    const sel = run([toggle('p2')], ok);
    expect(choiceOf(sel)).toEqual(P('p2'));
    expect(sel.status === 'done' && sel.dirty).toBe(true);
    const other = run([toggle('p1')], sel);
    expect(choiceOf(other)).toEqual(P('p1'));
    expect(choiceOf(run([toggle('p1')], other))).toBeNull();
  });

  it('A の自動選択を解除したあと、再検索の結果で勝手に選び直さない', () => {
    const auto = run([succeed('identified', ['p1'])], base);
    const off = run([toggle('p1')], auto);
    expect(choiceOf(off)).toBeNull();
    expect(choiceOf(run([succeed('identified', ['p1'])], off))).toBeNull();
  });

  it('利用者が選んだ候補は、再検索の結果にあれば残り、無ければ外れる', () => {
    const sel = run([succeed('candidates', ['p1', 'p2']), toggle('p2')], base);
    expect(choiceOf(run([succeed('identified', ['p1', 'p2'])], sel))).toEqual(P('p2'));
    expect(choiceOf(run([succeed('identified', ['p9'])], sel))).toBeNull();
  });

  it('カテゴリを変えたら選択も破棄する', () => {
    const auto = run([succeed('identified', ['p1'])], base);
    expect(choiceOf(run([{ type: 'setCategory', id: 'a', categoryId: 'knit' }], auto))).toBeNull();
  });
});
