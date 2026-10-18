import { thumbLayout } from '@/features/analysis/thumb-layout';

describe('thumbLayout', () => {
  it('正方形の写真の中央の正方形アイテムは、サムネイルいっぱいに拡大する', () => {
    const l = thumbLayout({ width: 1000, height: 1000 }, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 50);
    expect(l.width).toBeCloseTo(100);
    expect(l.height).toBeCloseTo(100);
    expect(l.left).toBeCloseTo(-25);
    expect(l.top).toBeCloseTo(-25);
  });

  it('縦長のアイテムは短い辺をサムネイルに合わせ(cover)、アイテムの中心が真ん中に来る', () => {
    // 写真 2000x1000、アイテムは x 0.4..0.5(200px) × y 0.1..0.9(800px)。短い辺 200px を 40 に合わせる → 倍率 0.2。
    const l = thumbLayout({ width: 2000, height: 1000 }, { x: 0.4, y: 0.1, w: 0.1, h: 0.8 }, 40);
    expect(l.width).toBeCloseTo(400);
    expect(l.height).toBeCloseTo(200);
    // 中心(0.45, 0.5) → (180, 100)。サムネイル中央 20 に合わせる。
    expect(l.left).toBeCloseTo(20 - 180);
    expect(l.top).toBeCloseTo(20 - 100);
  });

  it('大きさが 0 の枠でも壊れない', () => {
    const l = thumbLayout({ width: 1000, height: 1000 }, { x: 0.5, y: 0.5, w: 0, h: 0 }, 40);
    expect(Number.isFinite(l.width)).toBe(true);
    expect(Number.isFinite(l.left)).toBe(true);
  });
});
