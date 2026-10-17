import sharp from 'sharp';

import type { DetectorImage } from '@coordinate/shared';

import { MAX_INPUT_PIXELS } from './limits';

/** Claude に渡す画像の長辺(px)。これ以上は内部で縮小されるだけで、遅くなる。 */
export const MODEL_MAX_SIDE = 1568;

/** 向きを反映し、長辺を縮小して JPEG にする。画像はメモリ上のみで扱い、保存しない。 */
export async function prepareForModel(data: Uint8Array): Promise<DetectorImage> {
  const out = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MODEL_MAX_SIDE, height: MODEL_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: out, mediaType: 'image/jpeg' };
}
