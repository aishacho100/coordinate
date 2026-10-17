import type { RawItem, RawOutput } from './schema';
import { normalizeDetection } from './normalize';

const raw = (over: Partial<RawItem> = {}): RawItem => ({
  category_id: 'tshirt',
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
  colors: ['白'],
  visible_text: [],
  brand: null,
  brand_confidence: 0,
  detection_confidence: 0.9,
  category_confidence: 0.8,
  notes: null,
  ...over,
});
const out = (items: RawItem[]): RawOutput => ({ full_body: true, items });

describe('normalizeDetection', () => {
  it('正常な項目を DetectedItem に変換する(商品候補は空・ブランド無しは unidentified)', () => {
    const { items, dropped } = normalizeDetection(out([raw()]), 'm1');
    expect(dropped).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'item_1',
      categoryId: 'tshirt',
      candidates: [],
      level: 'unidentified',
      reviewState: 'auto',
      modelVersion: 'm1',
      brandCandidates: [],
    });
    expect(items[0]?.confidence).toMatchObject({ detection: 0.9, category: 0.8, brand: null, price: null });
  });

  it('不明なカテゴリ id は破棄する', () => {
    const { items, dropped } = normalizeDetection(out([raw({ category_id: 'spaceship' })]), 'm');
    expect(items).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('範囲外・はみ出す座標は破棄する', () => {
    const bad = [
      raw({ box: { x: -0.1, y: 0.1, w: 0.2, h: 0.2 } }),
      raw({ box: { x: 0.1, y: 0.1, w: 0, h: 0.2 } }),
      raw({ box: { x: 0.8, y: 0.1, w: 0.4, h: 0.2 } }),
    ];
    const { items, dropped } = normalizeDetection(out(bad), 'm');
    expect(items).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('信頼度が範囲外なら破棄する', () => {
    const { dropped } = normalizeDetection(out([raw({ detection_confidence: 1.5 })]), 'm');
    expect(dropped).toBe(1);
  });

  it('写真内の文字に根拠があるブランドだけ採用する(medium)', () => {
    const ok = raw({ brand: 'NIKE', visible_text: ['nike', 'JUST DO IT'], brand_confidence: 0.8 });
    const { items } = normalizeDetection(out([ok]), 'm');
    expect(items[0]).toMatchObject({ level: 'medium' });
    expect(items[0]?.brandCandidates).toEqual([{ name: 'NIKE', score: 0.8 }]);
    expect(items[0]?.confidence.brand).toBe(0.8);
    expect(items[0]?.rationale).toContain('nike');
  });

  it('文字の根拠が無いブランドは捨て、項目自体は残す(unidentified)', () => {
    const guess = raw({ brand: 'GUCCI', visible_text: [], brand_confidence: 0.9 });
    const { items } = normalizeDetection(out([guess]), 'm');
    expect(items).toHaveLength(1);
    expect(items[0]?.level).toBe('unidentified');
    expect(items[0]?.brandCandidates).toEqual([]);
    expect(items[0]?.confidence.brand).toBeNull();
  });

  it('全角・大文字小文字・記号の違いは同じ文字とみなす', () => {
    const r = raw({ brand: 'New Balance', visible_text: ['ＮＥＷ-ＢＡＬＡＮＣＥ'] });
    expect(normalizeDetection(out([r]), 'm').items[0]?.level).toBe('medium');
  });

  it('1 文字だけの読み取りは根拠にしない', () => {
    const r = raw({ brand: 'N', visible_text: ['N'] });
    expect(normalizeDetection(out([r]), 'm').items[0]?.level).toBe('unidentified');
  });

  it('ID は採用した項目に連番で振る', () => {
    const { items } = normalizeDetection(out([raw({ category_id: 'x' }), raw(), raw()]), 'm');
    expect(items.map((i) => i.id)).toEqual(['item_1', 'item_2']);
  });
});
