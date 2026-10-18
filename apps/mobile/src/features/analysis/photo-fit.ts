/** 結果画面の写真の高さの上限(画面高に対する割合)。虫眼鏡などの操作を最初の画面に収めるため。 */
export const PHOTO_MAX_HEIGHT_RATIO = 0.42;

/**
 * 写真のアスペクトを保ったまま、幅 availableWidth・高さ maxHeight の枠に収まる表示サイズを返す(contain)。
 * 点やタグは写真の表示サイズに対する割合で置くので、このサイズの枠にそのまま重ねればよい。
 */
export function fitPhoto(
  photo: { width: number; height: number },
  availableWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const aspect = photo.width / photo.height;
  const width = Math.max(0, Math.min(availableWidth, maxHeight * aspect));
  return { width, height: width / aspect };
}
