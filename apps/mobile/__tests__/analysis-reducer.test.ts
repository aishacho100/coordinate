import type { AnalyzeResponse, DetectedItem } from '@coordinate/shared';

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
