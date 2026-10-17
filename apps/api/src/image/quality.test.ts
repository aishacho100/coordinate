import sharp from 'sharp';

import { checkerJpeg, flatJpeg } from '../test-utils';
import { assessQuality } from './quality';

describe('assessQuality', () => {
  it('十分な解像度・明るさ・シャープさなら問題なし', async () => {
    const r = await assessQuality(await checkerJpeg(1000, 1000));
    expect(r.issues).toEqual([]);
    expect(r.width).toBe(1000);
    expect(r.height).toBe(1000);
  });

  it('短辺が小さいと low_resolution', async () => {
    const r = await assessQuality(await checkerJpeg(300, 300));
    expect(r.issues).toContain('low_resolution');
  });

  it('暗い画像は too_dark', async () => {
    const r = await assessQuality(await flatJpeg(1000, 1000, 15));
    expect(r.issues).toContain('too_dark');
  });

  it('のっぺりした画像は blurry', async () => {
    const r = await assessQuality(await flatJpeg(1000, 1000, 128));
    expect(r.issues).toContain('blurry');
    expect(r.issues).not.toContain('too_dark');
  });

  it('濃淡の幅が大きくてもエッジが無ければ blurry(入力の輝度のばらつきではなく、エッジの強さで判定する)', async () => {
    const w = 1000;
    const h = 1000;
    const raw = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = Math.round((x / (w - 1)) * 255);
    const gradient = await sharp(raw, { raw: { width: w, height: h, channels: 1 } }).jpeg({ quality: 95 }).toBuffer();
    const r = await assessQuality(gradient);
    expect(r.issues).toContain('blurry');
    expect(r.issues).not.toContain('too_dark');
  });

  it('壊れた画像は例外を投げる', async () => {
    await expect(assessQuality(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).rejects.toThrow();
  });
});
