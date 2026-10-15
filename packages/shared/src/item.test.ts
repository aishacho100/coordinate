import { DEFAULT_CATEGORIES, CategoryDefinitionSchema, DetectedItemSchema, BoxSchema } from './index';

describe('shared schemas', () => {
  it('既定カテゴリはすべてスキーマに適合し、IDが重複しない', () => {
    DEFAULT_CATEGORIES.forEach((c) => expect(CategoryDefinitionSchema.safeParse(c).success).toBe(true));
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.id)).size).toBe(DEFAULT_CATEGORIES.length);
  });

  it('範囲外の座標を拒否する', () => {
    expect(BoxSchema.safeParse({ x: 1.2, y: 0, w: 0.1, h: 0.1 }).success).toBe(false);
    expect(BoxSchema.safeParse({ x: 0.1, y: 0.1, w: 0, h: 0.1 }).success).toBe(false);
  });

  it('不正なAI出力(信頼度が範囲外)を拒否する', () => {
    const bad = { id: 'a', categoryId: 'sneakers', confidence: { detection: 5 } };
    expect(DetectedItemSchema.safeParse(bad).success).toBe(false);
  });
});
