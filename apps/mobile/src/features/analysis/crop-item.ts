import type { Box } from '@coordinate/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const PAD = 0.08;
const MIN_SIDE = 64;

/** 枠(写真全体に対する 0..1)に余白を足した画素の矩形。写真の外にはみ出さず、小さすぎる場合は広げる。 */
export function cropRect(box: Box, photo: { width: number; height: number }) {
  const x0 = Math.max(0, box.x - box.w * PAD);
  const y0 = Math.max(0, box.y - box.h * PAD);
  const x1 = Math.min(1, box.x + box.w * (1 + PAD));
  const y1 = Math.min(1, box.y + box.h * (1 + PAD));
  const originX = Math.floor(x0 * photo.width);
  const originY = Math.floor(y0 * photo.height);
  const width = Math.min(photo.width - originX, Math.max(MIN_SIDE, Math.ceil((x1 - x0) * photo.width)));
  const height = Math.min(photo.height - originY, Math.max(MIN_SIDE, Math.ceil((y1 - y0) * photo.height)));
  return { originX, originY, width, height };
}

/** アイテムの部分だけを切り抜いた JPEG の URI を作る。顔や背景を、必要以上に外部へ送らないため。 */
export async function cropItem(photo: { uri: string; width: number; height: number }, box: Box): Promise<string> {
  const rect = cropRect(box, photo);
  const cropped = await ImageManipulator.manipulate(photo.uri).crop(rect).renderAsync();
  const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return saved.uri;
}
