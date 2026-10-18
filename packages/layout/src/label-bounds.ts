/** ラベルの最大幅(キャンバス幅に対する比率)。左列(x=0.05)・右列(x=0.52)のどちらにも収まる。 */
export const LABEL_MAX_WIDTH_RATIO = 0.44;

/** 商品名の最大行数。超えたら末尾を「…」にする。 */
export const LABEL_NAME_MAX_LINES = 2;

export const labelMaxWidth = (canvasWidth: number) => canvasWidth * LABEL_MAX_WIDTH_RATIO;

/**
 * ラベルの左上位置(正規化座標)を、ラベル全体がキャンバス内に収まるよう
 * [0, 1 - ラベルサイズ/キャンバスサイズ] に収める。ラベルの方が大きいときは 0。
 */
export function clampLabelPosition(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  canvas: { w: number; h: number },
): { x: number; y: number } {
  const range = (v: number, len: number, total: number) =>
    Math.min(Math.max(v, 0), Math.max(0, 1 - len / total));
  return { x: range(pos.x, size.w, canvas.w), y: range(pos.y, size.h, canvas.h) };
}
