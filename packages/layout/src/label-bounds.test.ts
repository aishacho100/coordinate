import { clampLabelPosition, labelMaxWidth, LABEL_MAX_WIDTH_RATIO } from './label-bounds';

describe('labelMaxWidth', () => {
  it('キャンバス幅に対する比率(0.44 以下)で返す', () => {
    expect(LABEL_MAX_WIDTH_RATIO).toBeLessThanOrEqual(0.44);
    expect(labelMaxWidth(360)).toBeCloseTo(360 * LABEL_MAX_WIDTH_RATIO);
  });
  it('左列(0.05)と右列(0.52)の開始位置から幅いっぱい伸びても、キャンバスに収まる', () => {
    expect(0.05 + LABEL_MAX_WIDTH_RATIO).toBeLessThanOrEqual(1);
    expect(0.52 + LABEL_MAX_WIDTH_RATIO).toBeLessThanOrEqual(1);
  });
});

describe('clampLabelPosition', () => {
  const canvas = { w: 360, h: 480 };
  it('収まる位置はそのまま', () => {
    expect(clampLabelPosition({ x: 0.5, y: 0.5 }, { w: 100, h: 40 }, canvas)).toEqual({ x: 0.5, y: 0.5 });
  });
  it('右端・下端からはみ出す位置を [0, 1 - ラベル幅/キャンバス幅] に収める', () => {
    const p = clampLabelPosition({ x: 0.9, y: 0.99 }, { w: 180, h: 48 }, canvas);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.9);
  });
  it('負の位置は 0 にする', () => {
    expect(clampLabelPosition({ x: -0.1, y: -1 }, { w: 100, h: 40 }, canvas)).toEqual({ x: 0, y: 0 });
  });
  it('ラベルがキャンバスより大きいときは 0', () => {
    expect(clampLabelPosition({ x: 0.5, y: 0.5 }, { w: 400, h: 600 }, canvas)).toEqual({ x: 0, y: 0 });
  });
});
