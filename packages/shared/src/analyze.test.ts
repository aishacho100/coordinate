import { AnalyzeResponseSchema, ApiErrorSchema, type DetectedItem } from './index';

const item: DetectedItem = {
  id: 'item_1',
  categoryId: 'tshirt',
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
  appearance: { colors: ['白'], visibleText: [], notes: undefined },
  brandCandidates: [],
  candidates: [],
  confidence: { detection: 0.9, category: 0.8, brand: null, model: null, variant: null, price: null },
  level: 'unidentified',
  reviewState: 'auto',
  rationale: 'ブランドを示す文字・ロゴが確認できませんでした',
  modelVersion: 'claude-sonnet-5-5',
};

const base = {
  quality: { ok: true, issues: [] },
  items: [item],
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1500, outputTokens: 400 },
  timings: { quality: 30, detect: 4200, total: 4300 },
};

describe('analyze schemas', () => {
  it('正常なレスポンスを受け入れる(検出 0 件も可)', () => {
    expect(AnalyzeResponseSchema.safeParse(base).success).toBe(true);
    expect(AnalyzeResponseSchema.safeParse({ ...base, items: [] }).success).toBe(true);
  });

  it('品質の issue に未知の値があれば拒否する', () => {
    const bad = { ...base, quality: { ok: false, issues: ['weird'] } };
    expect(AnalyzeResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('負のトークン数・不正なアイテムを拒否する', () => {
    expect(AnalyzeResponseSchema.safeParse({ ...base, usage: { inputTokens: -1, outputTokens: 0 } }).success).toBe(false);
    expect(AnalyzeResponseSchema.safeParse({ ...base, items: [{ id: 'x' }] }).success).toBe(false);
  });

  it('エラーボディは既知のコードのみ', () => {
    expect(ApiErrorSchema.safeParse({ error: 'not_configured', message: 'm' }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: 'boom', message: 'm' }).success).toBe(false);
  });
});
