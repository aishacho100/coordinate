import sharp from 'sharp';

import type { QualityIssue } from '@coordinate/shared';

/** 初期値。実写真で調整する(docs/phase3-model-comparison.md に結果を残す)。 */
export const THRESHOLDS = {
  /** 短辺がこれ未満なら解像度不足(px)。 */
  minShortSide: 720,
  /** 平均輝度(0〜255)がこれ未満なら暗すぎる。 */
  minMeanLuma: 60,
  /** ラプラシアン応答の標準偏差がこれ未満ならぶれ/ピンぼけ。 */
  minLaplacianStdev: 8,
} as const;

const ANALYSIS_SIDE = 512;

export type QualityAssessment = { issues: QualityIssue[]; width: number; height: number };

/** 解像度・明るさ・ぶれを評価する。全身が写っているかは検出結果から別に判定する。 */
export async function assessQuality(data: Uint8Array): Promise<QualityAssessment> {
  const meta = await sharp(data).rotate().metadata();
  // rotate() は EXIF の向きを反映する。メタデータの幅・高さは回転前なので、向きに応じて入れ替える。
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  if (width === 0 || height === 0) throw new Error('画像サイズを取得できません');

  const { data: gray, info } = await sharp(data)
    .rotate()
    .resize({ width: ANALYSIS_SIDE, height: ANALYSIS_SIDE, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: info.width, height: info.height, channels: 1 as const } };

  const mean = (await sharp(gray, raw).stats()).channels[0]?.mean ?? 0;
  // 負の応答を残すため offset=128 を足す。標準偏差は offset の影響を受けない。
  const lap = await sharp(gray, raw)
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .stats();
  const stdev = lap.channels[0]?.stdev ?? 0;

  const issues: QualityIssue[] = [];
  if (Math.min(width, height) < THRESHOLDS.minShortSide) issues.push('low_resolution');
  if (mean < THRESHOLDS.minMeanLuma) issues.push('too_dark');
  if (stdev < THRESHOLDS.minLaplacianStdev) issues.push('blurry');
  return { issues, width, height };
}
