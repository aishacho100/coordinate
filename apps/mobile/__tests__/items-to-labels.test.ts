import type { CropRect } from '@coordinate/layout';

import type { ResultItem } from '@/features/analysis/analysis-reducer';
import { itemsToLabelInputs } from '@/features/analysis/items-to-labels';

const item = (id: string, x: number, y: number, over: Partial<ResultItem> = {}): ResultItem => ({
  id,
  categoryId: 'tshirt',
  brand: '',
  box: { x, y, w: 0.2, h: 0.2 },
  origin: 'ai',
  level: 'unidentified',
  ...over,
});

const full: CropRect = { x: 0, y: 0, w: 1, h: 1 };
let n = 0;
const ids = () => `l_${++n}`;

describe('itemsToLabelInputs', () => {
  it('アンカーは枠の中心、名前はカテゴリ名、itemId は項目 ID', () => {
    const [l] = itemsToLabelInputs([item('a', 0.2, 0.3, { brand: 'NIKE' })], full, ids);
    expect(l).toMatchObject({ itemId: 'a', brand: 'NIKE', name: 'Tシャツ' });
    expect(l?.anchor?.x).toBeCloseTo(0.3);
    expect(l?.anchor?.y).toBeCloseTo(0.4);
    expect(l?.price).toBeUndefined();
  });

  it('左半分のアイテムのラベルは左、右半分は右に置く', () => {
    const [left, right] = itemsToLabelInputs([item('a', 0.1, 0.2), item('b', 0.7, 0.2)], full, ids);
    expect(left?.position?.x).toBeLessThan(0.3);
    expect(right?.position?.x).toBeGreaterThan(0.4);
  });

  it('同じ側で縦に近い項目は重ならないようにずらす', () => {
    const out = itemsToLabelInputs([item('a', 0.1, 0.2), item('b', 0.1, 0.22), item('c', 0.1, 0.24)], full, ids);
    const ys = out.map((l) => l.position?.y ?? 0);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.88);
  });

  it('トリミング後のキャンバス座標に変換し、外側は端に丸める', () => {
    const crop: CropRect = { x: 0.2, y: 0, w: 0.6, h: 1 };
    const [inside, outside] = itemsToLabelInputs([item('a', 0.4, 0.4), item('b', 0.0, 0.4)], crop, ids);
    // 中心 x=0.5 → (0.5-0.2)/0.6 = 0.5
    expect(inside?.anchor?.x).toBeCloseTo(0.5);
    // 中心 x=0.1 はトリミングの外 → 0 に丸める
    expect(outside?.anchor?.x).toBe(0);
  });

  it('ID は渡した関数で振り、順序を保つ', () => {
    n = 0;
    const out = itemsToLabelInputs([item('a', 0.1, 0.1), item('b', 0.7, 0.5)], full, ids);
    expect(out.map((l) => l.id)).toEqual(['l_1', 'l_2']);
    expect(out.map((l) => l.itemId)).toEqual(['a', 'b']);
  });

  it('カテゴリが未知なら名前は空にする', () => {
    const [l] = itemsToLabelInputs([item('a', 0.1, 0.1, { categoryId: 'unknown' })], full, ids);
    expect(l?.name).toBe('');
  });
});
