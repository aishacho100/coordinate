import { cropRect } from '@/features/analysis/crop-item';

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

const photo = { width: 1000, height: 2000 };

describe('cropRect', () => {
  it('枠の周りに 8% の余白が付く', () => {
    const r = cropRect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, photo);
    // x: 0.4 - 0.016 = 0.384 → 384、幅: 0.2 * 1.16 = 0.232 → 約 232(浮動小数点の切り上げで +1 まで許容)
    expect(r.originX).toBe(384);
    expect(r.width).toBeGreaterThanOrEqual(232);
    expect(r.width).toBeLessThanOrEqual(233);
    // y: 0.384 → 768、高さ: 0.232 * 2000 → 約 464
    expect(r.originY).toBe(768);
    expect(r.height).toBeGreaterThanOrEqual(464);
    expect(r.height).toBeLessThanOrEqual(465);
  });

  it('写真の外にはみ出さない', () => {
    const r = cropRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, photo);
    expect(r.originX).toBe(0);
    expect(r.originY).toBe(0);
  });

  it('極小の枠は最小 64px に広がる', () => {
    const r = cropRect({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, photo);
    expect(r.width).toBe(64);
    expect(r.height).toBe(64);
  });

  it('右下の端でも範囲内に収まる', () => {
    for (const box of [
      { x: 0.9, y: 0.9, w: 0.1, h: 0.1 },
      { x: 0.999, y: 0.999, w: 0.001, h: 0.001 },
    ]) {
      const r = cropRect(box, photo);
      expect(r.originX + r.width).toBeLessThanOrEqual(photo.width);
      expect(r.originY + r.height).toBeLessThanOrEqual(photo.height);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });
});
