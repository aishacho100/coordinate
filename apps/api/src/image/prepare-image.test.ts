import sharp from 'sharp';

import { checkerJpeg } from '../test-utils';
import { MODEL_MAX_SIDE, prepareForModel } from './prepare-image';

describe('prepareForModel', () => {
  it('長辺を 1568px に縮小し JPEG にする', async () => {
    const out = await prepareForModel(await checkerJpeg(3000, 2000));
    expect(out.mediaType).toBe('image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(MODEL_MAX_SIDE);
    expect(meta.format).toBe('jpeg');
  });

  it('小さい画像は拡大しない', async () => {
    const out = await prepareForModel(await checkerJpeg(400, 300));
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(400);
  });
});
