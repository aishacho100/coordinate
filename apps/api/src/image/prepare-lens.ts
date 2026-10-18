import sharp from 'sharp';

import { MAX_INPUT_PIXELS } from './limits';

/** Lens に送る画像の長辺(px)。 */
export const LENS_MAX_SIDE = 1024;
/** SerpApi の Image API が受け付ける最大サイズ(500KB)。 */
export const LENS_MAX_BYTES = 500 * 1024;

const QUALITIES = [85, 75, 65, 55, 45, 35, 25] as const;
/** 最低品質でも超えたときの、寸法の縮小率と下限(px)。 */
const SHRINK_RATIO = 0.8;
const MIN_SIDE = 64;

/**
 * 画像検索(Lens)に送る JPEG を作る。向きを反映し、長辺を 1024px 以下にし、
 * 500KB 以下になるまで品質を下げ、それでも超えるなら寸法も縮める。メモリ上のみで扱い、保存しない。
 */
export async function prepareForLens(
  data: Uint8Array,
  opts: { maxBytes?: number } = {},
): Promise<Uint8Array> {
  const maxBytes = opts.maxBytes ?? LENS_MAX_BYTES;
  // 向きを反映した画素にそろえてから、縮小と再エンコードを繰り返す。
  const upright = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: LENS_MAX_SIDE, height: LENS_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  let side = Math.max(upright.info.width, upright.info.height);
  let out: Buffer | null = null;
  for (;;) {
    const base = sharp(upright.data).resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });
    for (const quality of QUALITIES) {
      out = await base.clone().jpeg({ quality }).toBuffer();
      if (out.byteLength <= maxBytes) return out;
    }
    if (side <= MIN_SIDE) return out!;
    side = Math.max(MIN_SIDE, Math.floor(side * SHRINK_RATIO));
  }
}
