import { z } from 'zod';

import { DetectedItemSchema, type DetectedItem } from './item';

export const QualityIssueSchema = z.enum(['low_resolution', 'too_dark', 'blurry', 'not_full_body']);
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const QualitySchema = z.object({ ok: z.boolean(), issues: z.array(QualityIssueSchema) });
export type Quality = z.infer<typeof QualitySchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

/** POST /v1/analyze の成功レスポンス。タイミングは ms。 */
export const AnalyzeResponseSchema = z.object({
  quality: QualitySchema,
  items: z.array(DetectedItemSchema),
  model: z.string().min(1),
  usage: UsageSchema,
  timings: z.object({
    quality: z.number().nonnegative(),
    detect: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const ApiErrorCodeSchema = z.enum([
  'invalid_image',
  'too_large',
  'analysis_failed',
  'not_configured',
  'rate_limited',
  'invalid_request',
  'quota_exceeded',
  'search_unavailable',
  'identify_failed',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({ error: ApiErrorCodeSchema, message: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type DetectorImage = { data: Uint8Array; mediaType: 'image/jpeg' | 'image/png' };

export type DetectorResult = {
  items: DetectedItem[];
  /** 頭から足元まで写っているか(モデルの判定)。 */
  fullBody: boolean;
  /** 実際に応答したモデル名。 */
  model: string;
  usage: Usage;
};

/** アイテム検出の差し替え口。Phase 3 の実装は Claude Vision。 */
export interface Detector {
  detect(image: DetectorImage): Promise<DetectorResult>;
}

/** 費用管理用のログ 1 件。画像・API キーは含めない。 */
export type UsageRecord = Usage & { model: string; detectMs: number };
