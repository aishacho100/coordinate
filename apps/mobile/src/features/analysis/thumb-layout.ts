type Size = { width: number; height: number };
type Box = { x: number; y: number; w: number; h: number };

/** 倍率の上限。枠がほぼ 0 のときに画像が巨大になるのを防ぐ。 */
const MAX_ZOOM = 20;

/**
 * 写真の中のアイテムの枠を、size 四方のサムネイルに映すための画像の配置を返す。
 * 画像ファイルを切り出さず、写真をそのまま拡大・平行移動して見せるための計算(cover:枠の短い辺をサムネイルに合わせる)。
 * photo は写真の縦横比(単位は問わない)、box は 0〜1 の割合。
 */
export function thumbLayout(photo: Size, box: Box, size: number) {
  const bw = Math.max(box.w * photo.width, 1);
  const bh = Math.max(box.h * photo.height, 1);
  const scale = Math.min(size / Math.min(bw, bh), (size * MAX_ZOOM) / Math.max(photo.width, photo.height));
  const cx = (box.x + box.w / 2) * photo.width * scale;
  const cy = (box.y + box.h / 2) * photo.height * scale;
  return {
    width: photo.width * scale,
    height: photo.height * scale,
    left: size / 2 - cx,
    top: size / 2 - cy,
  };
}
