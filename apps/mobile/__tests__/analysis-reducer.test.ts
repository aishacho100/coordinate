import type { AnalyzeResponse, DetectedItem, IdentifyResponse } from '@coordinate/shared';

import {
  analysisReducer,
  initialAnalysisState,
  type AnalysisAction,
  type AnalysisState,
} from '@/features/analysis/analysis-reducer';

const det = (id: string, over: Partial<DetectedItem> = {}): DetectedItem => ({
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
  modelVersion: 'm',
  ...over,
});

const response = (items: DetectedItem[]): AnalyzeResponse => ({
  quality: { ok: false, issues: ['blurry'] },
  items,
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1, outputTokens: 1 },
  timings: { quality: 10, detect: 20, total: 31 },
});

const run = (actions: AnalysisAction[], from: AnalysisState = initialAnalysisState) =>
  actions.reduce(analysisReducer, from);

const done = (items: DetectedItem[]) => run([{ type: 'start' }, { type: 'succeeded', response: response(items) }]);

describe('analysisReducer', () => {
  it('start で loading、失敗で kind を保持する', () => {
    expect(run([{ type: 'start' }]).status).toBe('loading');
    expect(run([{ type: 'start' }, { type: 'failed', kind: 'network' }])).toEqual({ status: 'failed', kind: 'network' });
  });

  it('成功すると検出結果を編集用の項目に変換する(ブランドは候補の先頭、無ければ空)', () => {
    const s = done([
      det('a', { brandCandidates: [{ name: 'NIKE', score: 0.8 }], level: 'medium' }),
      det('b'),
    ]);
    if (s.status !== 'done') throw new Error('done ではありません');
    expect(s.items.map((i) => [i.id, i.brand, i.origin, i.level])).toEqual([
      ['a', 'NIKE', 'ai', 'medium'],
      ['b', '', 'ai', 'unidentified'],
    ]);
    expect(s.quality.issues).toEqual(['blurry']);
    expect(s.applied).toBe(false);
    expect(s.dirty).toBe(false);
  });

  it('解析直後は dirty ではなく、編集・追加・削除・商品の検索で dirty になる', () => {
    const base = done([det('a')]);
    const dirtyOf = (a: AnalysisAction) => {
      const s = run([a], base);
      if (s.status !== 'done') throw new Error();
      return s.dirty;
    };
    expect(dirtyOf({ type: 'applied' })).toBe(false);
    expect(dirtyOf({ type: 'setCategory', id: 'a', categoryId: 'knit' })).toBe(true);
    expect(dirtyOf({ type: 'setBrand', id: 'a', brand: 'UNIQLO' })).toBe(true);
    expect(dirtyOf({ type: 'remove', id: 'a' })).toBe(true);
    expect(dirtyOf({ type: 'addManual', id: 'm1', categoryId: 'cap' })).toBe(true);
    expect(dirtyOf({ type: 'identifyStart', id: 'a' })).toBe(true);
    expect(dirtyOf({ type: 'identifyFailed', id: 'a', kind: 'network' })).toBe(true);
  });

  it('カテゴリ変更・ブランド入力・削除ができる', () => {
    let s = done([det('a'), det('b')]);
    s = run([{ type: 'setCategory', id: 'a', categoryId: 'knit' }, { type: 'setBrand', id: 'a', brand: 'UNIQLO' }, { type: 'remove', id: 'b' }], s);
    if (s.status !== 'done') throw new Error();
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ id: 'a', categoryId: 'knit', brand: 'UNIQLO' });
  });

  it('手動追加は origin=manual で、unidentified になる', () => {
    let s = done([]);
    s = run([{ type: 'addManual', id: 'm1', categoryId: 'sneakers' }], s);
    if (s.status !== 'done') throw new Error();
    expect(s.items[0]).toMatchObject({ id: 'm1', origin: 'manual', categoryId: 'sneakers', brand: '', level: 'unidentified' });
  });

  it('done 以外での編集操作は無視する', () => {
    const s = run([{ type: 'remove', id: 'a' }]);
    expect(s).toBe(initialAnalysisState);
  });

  it('applied を立てられ、reset で初期状態に戻る', () => {
    let s = done([det('a')]);
    s = run([{ type: 'applied' }], s);
    if (s.status !== 'done') throw new Error();
    expect(s.applied).toBe(true);
    expect(run([{ type: 'reset' }], s)).toBe(initialAnalysisState);
  });
});

const identifyResponse: IdentifyResponse = {
  itemId: 'a',
  verdict: 'unidentified',
  level: 'unidentified',
  rationale: '特定できませんでした',
  candidates: [],
  searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
  comparison: 'skipped',
  queries: ['NIKE スニーカー'],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 1, lensSearches: 1 },
  estimatedCostUsd: null,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  timings: { total: 10 },
};

const itemOf = (s: AnalysisState, id: string) => {
  if (s.status !== 'done') throw new Error('done ではありません');
  const found = s.items.find((i) => i.id === id);
  if (!found) throw new Error(`項目 ${id} がありません`);
  return found;
};

describe('商品特定の状態', () => {
  const base = done([det('a')]);

  it('AI の項目は検出結果を保持し、特定の状態は idle から始まる', () => {
    expect(itemOf(base, 'a').detected?.id).toBe('a');
    expect(itemOf(base, 'a').identify).toEqual({ status: 'idle' });
  });

  it('開始 → 成功 / 失敗で状態が変わる', () => {
    const loading = run([{ type: 'identifyStart', id: 'a' }], base);
    expect(itemOf(loading, 'a').identify).toEqual({ status: 'loading' });
    const ok = run([{ type: 'identifySucceeded', id: 'a', response: identifyResponse }], loading);
    expect(itemOf(ok, 'a').identify).toEqual({ status: 'done', response: identifyResponse });
    const ng = run([{ type: 'identifyFailed', id: 'a', kind: 'quota_exceeded' }], loading);
    expect(itemOf(ng, 'a').identify).toEqual({ status: 'failed', kind: 'quota_exceeded' });
  });

  it('カテゴリを変えたら、古い特定結果は破棄する', () => {
    const ok = run(
      [{ type: 'identifyStart', id: 'a' }, { type: 'identifySucceeded', id: 'a', response: identifyResponse }],
      base,
    );
    const changed = run([{ type: 'setCategory', id: 'a', categoryId: 'shoes_other' }], ok);
    expect(itemOf(changed, 'a').identify).toEqual({ status: 'idle' });
  });

  it('手動追加の項目は detected が null', () => {
    const added = run([{ type: 'addManual', id: 'm_1', categoryId: 'tshirt' }], base);
    expect(itemOf(added, 'm_1').detected).toBeNull();
    expect(itemOf(added, 'm_1').identify).toEqual({ status: 'idle' });
  });
});
