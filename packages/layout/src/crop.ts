import type { EditDocument } from '@coordinate/shared';

export type CropRect = { x: number; y: number; w: number; h: number };
export type Aspect = EditDocument['aspect'];

/** 幅/高さ。original は元画像の比率に従う。 */
export function aspectRatio(aspect: Aspect, imgW: number, imgH: number): number {
  switch (aspect) {
    case '1:1':
      return 1;
    case '4:5':
      return 4 / 5;
    case '9:16':
      return 9 / 16;
    case 'original':
      return imgW / imgH;
  }
}

/** 指定比率で元画像内に収まる最大の矩形(正規化座標)。focus は矩形の中心(0〜1)。 */
export function computeCrop(
  imgW: number,
  imgH: number,
  aspect: Aspect,
  focus: { cx: number; cy: number } = { cx: 0.5, cy: 0.5 },
): CropRect {
  if (imgW <= 0 || imgH <= 0) throw new Error('画像サイズが不正です');
  const target = aspectRatio(aspect, imgW, imgH);
  const imgRatio = imgW / imgH;
  // 正規化座標での幅と高さ
  let w = 1;
  let h = 1;
  if (target < imgRatio) w = target / imgRatio; // 横を詰める
  else if (target > imgRatio) h = imgRatio / target; // 縦を詰める
  return clampCrop({ x: focus.cx - w / 2, y: focus.cy - h / 2, w, h });
}

/** 矩形が 0〜1 の範囲に収まるよう位置を補正する(サイズは変えない)。 */
export function clampCrop(r: CropRect): CropRect {
  const w = Math.min(Math.max(r.w, 0), 1);
  const h = Math.min(Math.max(r.h, 0), 1);
  return {
    w,
    h,
    x: Math.min(Math.max(r.x, 0), 1 - w),
    y: Math.min(Math.max(r.y, 0), 1 - h),
  };
}

/** 矩形を正規化座標で平行移動する(画像外にはみ出さない)。 */
export function panCrop(r: CropRect, dx: number, dy: number): CropRect {
  return clampCrop({ ...r, x: r.x + dx, y: r.y + dy });
}

/** crop 後のキャンバス比率(幅/高さ)。 */
export function cropAspectRatio(r: CropRect, imgW: number, imgH: number): number {
  return (r.w * imgW) / (r.h * imgH);
}
