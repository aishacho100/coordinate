import { DetectedItemSchema } from '@coordinate/shared';

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

  it.each([
    ['The North Face', 'THE'],
    ['New Balance', 'NEW'],
    ['Polo Ralph Lauren', 'POLO'],
    ['Adidas', 'AS'],
    ['ON', 'SEASON'],
    ['GU', 'GUESS'],
    ['Gap', 'GAPS'],
    ['Champion', 'Champions League'],
  ])('文字の断片や別の単語に埋もれた一致は根拠にしない: %s / %s', (brand, text) => {
    const r = raw({ brand, visible_text: [text], brand_confidence: 0.9 });
    expect(normalizeDetection(out([r]), 'm').items[0]?.level).toBe('unidentified');
  });

  it.each([
    ['NIKE', 'NIKE JUST DO IT'],
    ['New Balance', 'NewBalance'],
    ['New Balance', 'new-balance 574'],
    ["Levi's", 'LEVIS'],
    ['UNIQLO', 'UNIQLO U'],
    ['GU', 'GU'],
  ])('ブランド全体が語として読み取れていれば根拠にする: %s / %s', (brand, text) => {
    const r = raw({ brand, visible_text: [text], brand_confidence: 0.9 });
    expect(normalizeDetection(out([r]), 'm').items[0]?.level).toBe('medium');
  });

  it('ブランドの信頼度が範囲外ならブランドだけ捨て、項目は残す', () => {
    const r = raw({ brand: 'NIKE', visible_text: ['NIKE'], brand_confidence: 5 });
    const { items } = normalizeDetection(out([r]), 'm');
    expect(items).toHaveLength(1);
    expect(items[0]?.level).toBe('unidentified');
    expect(items[0]?.brandCandidates).toEqual([]);
  });

  it('ID は採用した項目に連番で振る', () => {
    const { items } = normalizeDetection(out([raw({ category_id: 'x' }), raw(), raw()]), 'm');
    expect(items.map((i) => i.id)).toEqual(['item_1', 'item_2']);
  });
  it('長すぎる・多すぎる値は共有スキーマの上限に切り詰め、応答検証を通す', () => {
    const { items } = normalizeDetection(
      out([
        raw({
          colors: Array(15).fill('a'.repeat(60)),
          visible_text: ['NIKE', ...Array(40).fill('b'.repeat(300))],
          notes: 'n'.repeat(900),
          brand: 'Nike',
          brand_confidence: 0.9,
        }),
      ]),
      'm'.repeat(150),
    );
    const it0 = items[0]!;
    expect(it0.appearance.colors).toHaveLength(10);
    expect(it0.appearance.colors.every((c) => c.length === 40)).toBe(true);
    expect(it0.appearance.visibleText).toHaveLength(30);
    expect(it0.appearance.visibleText[1]).toHaveLength(200);
    expect(it0.appearance.notes).toHaveLength(500);
    expect(it0.modelVersion).toHaveLength(100);
    expect(DetectedItemSchema.safeParse(it0).success).toBe(true);
  });

  it('上限を超える長さのブランド名は採用しない', () => {
    const long = 'Nike ' + 'x'.repeat(120);
    const { items } = normalizeDetection(out([raw({ visible_text: [long], brand: long, brand_confidence: 0.9 })]), 'm');
    expect(items[0]?.brandCandidates).toEqual([]);
    expect(DetectedItemSchema.safeParse(items[0]).success).toBe(true);
  });
});
