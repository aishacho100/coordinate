import { randomBytes } from 'node:crypto';

import sharp from 'sharp';

import { checkerJpeg } from '../test-utils';
import { LENS_MAX_BYTES, LENS_MAX_SIDE, prepareForLens } from './prepare-lens';

/** 圧縮しにくいノイズ画像。 */
async function noiseJpeg(width: number, height: number): Promise<Uint8Array> {
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe('prepareForLens', () => {
  it('長辺を 1024px 以下に縮小し JPEG にする', async () => {
    const out = await prepareForLens(await checkerJpeg(3000, 2000));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(LENS_MAX_SIDE);
    expect(out.byteLength).toBeLessThanOrEqual(LENS_MAX_BYTES);
  });

  it('小さい画像は拡大しない', async () => {
    const out = await prepareForLens(await checkerJpeg(400, 300));
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('EXIF の向きを反映する(横長に保存された向き 6 は縦長になる)', async () => {
    const landscape = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#c33' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await prepareForLens(landscape);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(600);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('ノイズの多い画像は品質を下げて 500KB 以下にする', async () => {
    const input = await noiseJpeg(1200, 1200);
    const out = await prepareForLens(input);
    expect(out.byteLength).toBeLessThanOrEqual(LENS_MAX_BYTES);
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(LENS_MAX_SIDE);
  });

  it('最低品質でも超えるときは寸法も縮める', async () => {
    const input = await noiseJpeg(1024, 1024);
    // 上限を極端に小さくして、寸法の縮小まで進む経路を確かめる。
    const out = await prepareForLens(input, { maxBytes: 20 * 1024 });
    expect(out.byteLength).toBeLessThanOrEqual(20 * 1024);
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThan(LENS_MAX_SIDE);
  });
});
