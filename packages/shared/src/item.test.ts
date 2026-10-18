import { DEFAULT_CATEGORIES, CategoryDefinitionSchema, DetectedItemSchema, BoxSchema, ProductSchema } from './index';

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
  describe('DetectedItem の長さ・個数の上限', () => {
    const base = {
      id: 'item_1',
      categoryId: 'tshirt',
      box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      appearance: { colors: ['白'], visibleText: ['NIKE'] },
      brandCandidates: [],
      candidates: [],
      confidence: { detection: 0.9, category: 0.9, brand: null, model: null, variant: null, price: null },
      level: 'unidentified',
      reviewState: 'auto',
      rationale: 'x',
      modelVersion: 'm',
    };
    const withAppearance = (a: object) => ({ ...base, appearance: { ...base.appearance, ...a } });

    it('上限ちょうどは通り、超えると拒否する', () => {
      const ok = (v: unknown) => DetectedItemSchema.safeParse(v).success;
      expect(ok(withAppearance({ visibleText: Array(30).fill('a'.repeat(200)) }))).toBe(true);
      expect(ok(withAppearance({ visibleText: Array(31).fill('a') }))).toBe(false);
      expect(ok(withAppearance({ visibleText: ['a'.repeat(201)] }))).toBe(false);
      expect(ok(withAppearance({ colors: Array(11).fill('白') }))).toBe(false);
      expect(ok(withAppearance({ colors: ['a'.repeat(41)] }))).toBe(false);
      for (const k of ['notes', 'pattern', 'material']) {
        expect(ok(withAppearance({ [k]: 'a'.repeat(500) }))).toBe(true);
        expect(ok(withAppearance({ [k]: 'a'.repeat(501) }))).toBe(false);
      }
      expect(ok({ ...base, rationale: 'a'.repeat(501) })).toBe(false);
      expect(ok({ ...base, brandCandidates: Array(6).fill({ name: 'a', score: 0.5 }) })).toBe(false);
      expect(ok({ ...base, brandCandidates: [{ name: 'a'.repeat(101), score: 0.5 }] })).toBe(false);
      expect(ok({ ...base, id: 'a'.repeat(101) })).toBe(false);
      expect(ok({ ...base, categoryId: 'a'.repeat(101) })).toBe(false);
      expect(ok({ ...base, modelVersion: 'a'.repeat(101) })).toBe(false);
    });
  });

  describe('Product の URL は https のみ', () => {
    const p = { source: 's', productId: 'p', brand: '', name: 'n', fetchedAt: '2026-10-18T00:00:00.000Z' };
    it('http や javascript: を拒否する', () => {
      expect(ProductSchema.safeParse({ ...p, pageUrl: 'https://example.com/a', imageUrl: 'https://example.com/a.jpg' }).success).toBe(true);
      expect(ProductSchema.safeParse({ ...p, pageUrl: 'http://example.com/a' }).success).toBe(false);
      expect(ProductSchema.safeParse({ ...p, pageUrl: 'javascript:alert(1)' }).success).toBe(false);
      expect(ProductSchema.safeParse({ ...p, imageUrl: 'http://example.com/a.jpg' }).success).toBe(false);
    });
  });
});
