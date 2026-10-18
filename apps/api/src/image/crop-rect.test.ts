import { cropRect } from './crop-rect';

const photo = { width: 1000, height: 2000 };

describe('cropRect', () => {
  it('枠に 8% の余白を足す', () => {
    const r = cropRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.25 }, photo);
    expect(r).toEqual({ left: 160, top: 360, width: 580, height: 581 });
  });
  it('写真の外にはみ出さない', () => {
    const r = cropRect({ x: 0, y: 0.9, w: 1, h: 0.1 }, photo);
    expect(r.left).toBe(0);
    expect(r.left + r.width).toBeLessThanOrEqual(photo.width);
    expect(r.top + r.height).toBeLessThanOrEqual(photo.height);
  });
  it('小さい枠は最小 64px に広げる', () => {
    const r = cropRect({ x: 0.5, y: 0.5, w: 0.01, h: 0.005 }, photo);
    expect(r.width).toBe(64);
    expect(r.height).toBe(64);
  });
  it('端の小さい枠でも、矩形は写真の内側に収まる', () => {
    const r = cropRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, { width: 100, height: 100 });
    expect(r.left + r.width).toBeLessThanOrEqual(100);
    expect(r.top + r.height).toBeLessThanOrEqual(100);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});
