import type { Box } from '@coordinate/shared';

const PAD = 0.08;
const MIN_SIDE = 64;

/**
 * 枠(写真全体に対する 0..1)に 8% の余白を足した画素の矩形。写真の外にはみ出さず、小さすぎる場合は広げる。
 * モバイルの cropRect(apps/mobile/src/features/analysis/crop-item.ts)と同じ考え方。評価スクリプトで使う。
 */
export function cropRect(box: Box, photo: { width: number; height: number }) {
  const x0 = Math.max(0, box.x - box.w * PAD);
  const y0 = Math.max(0, box.y - box.h * PAD);
  const x1 = Math.min(1, box.x + box.w * (1 + PAD));
  const y1 = Math.min(1, box.y + box.h * (1 + PAD));
  const left = Math.min(Math.floor(x0 * photo.width), Math.max(0, photo.width - 1));
  const top = Math.min(Math.floor(y0 * photo.height), Math.max(0, photo.height - 1));
  const width = Math.min(photo.width - left, Math.max(MIN_SIDE, Math.ceil((x1 - x0) * photo.width)));
  const height = Math.min(photo.height - top, Math.max(MIN_SIDE, Math.ceil((y1 - y0) * photo.height)));
  return { left, top, width, height };
}
