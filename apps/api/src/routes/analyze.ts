import type { FastifyInstance, FastifyReply } from 'fastify';

import { AnalyzeResponseSchema, type ApiErrorCode, type QualityIssue } from '@coordinate/shared';

import type { AppDeps } from '../app';
import { prepareForModel } from '../image/prepare-image';
import { assessQuality } from '../image/quality';
import { validateImage } from '../image/validate-image';
import { estimateCostUsd } from '../usage';

const MESSAGES: Record<ApiErrorCode, string> = {
  invalid_image: '画像を読み取れませんでした。JPEG または PNG の写真を選んでください。',
  too_large: '画像が大きすぎます。10MB 以下の写真を選んでください。',
  analysis_failed: '解析に失敗しました。時間をおいて、もう一度お試しください。',
  not_configured: '解析サーバーが設定されていません。',
  rate_limited: '短時間にリクエストが集中しています。少し待ってからお試しください。',
};

export function sendError(reply: FastifyReply, status: number, error: ApiErrorCode) {
  return reply.status(status).send({ error, message: MESSAGES[error] });
}

export const RATE_LIMIT_BODY = { error: 'rate_limited' as const, message: MESSAGES.rate_limited };

export function registerAnalyzeRoute(app: FastifyInstance, deps: AppDeps) {
  app.post('/v1/analyze', { config: { rateLimit: {} } }, async (req, reply) => {
    const t0 = performance.now();

    // req.file() は最初のファイルで返るため、後続のパートや上限超過(fields/parts)に気づけない。
    // 全パートを読み切り、ファイル 1 つだけの multipart だけを受け付ける。
    let data: Buffer | undefined;
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file' || data) return sendError(reply, 400, 'invalid_image');
        data = await part.toBuffer();
        if (part.file.truncated) return sendError(reply, 400, 'too_large');
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'FST_REQ_FILE_TOO_LARGE'
        ? sendError(reply, 400, 'too_large')
        : sendError(reply, 400, 'invalid_image');
    }
    if (!data) return sendError(reply, 400, 'invalid_image');

    // 画像検証は他の処理より前に行う。
    if (!validateImage(data).ok) return sendError(reply, 400, 'invalid_image');
    if (!deps.detector) return sendError(reply, 503, 'not_configured');

    let quality;
    let prepared;
    const tq = performance.now();
    try {
      quality = await assessQuality(data);
      prepared = await prepareForModel(data);
    } catch {
      return sendError(reply, 400, 'invalid_image');
    }
    const qualityMs = performance.now() - tq;

    const td = performance.now();
    let result;
    try {
      result = await deps.detector.detect(prepared);
    } catch (e) {
      // 画像・キー・上流の詳細はログに残さない。種類だけ記録する。
      req.log.error({ errorName: e instanceof Error ? e.name : 'unknown', status: (e as { status?: number }).status }, 'detect failed');
      return sendError(reply, 502, 'analysis_failed');
    }
    const detectMs = performance.now() - td;

    const issues: QualityIssue[] = [...quality.issues];
    if (!result.fullBody) issues.push('not_full_body');

    req.log.info(
      {
        usage: {
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          detectMs: Math.round(detectMs),
          estimatedCostUsd: estimateCostUsd(result.usage, deps.config.pricing),
        },
        items: result.items.length,
      },
      'analyzed',
    );

    const parsed = AnalyzeResponseSchema.safeParse({
      quality: { ok: issues.length === 0, issues },
      items: result.items,
      model: result.model,
      usage: result.usage,
      timings: {
        quality: Math.round(qualityMs),
        detect: Math.round(detectMs),
        total: Math.round(performance.now() - t0),
      },
    });
    if (!parsed.success) {
      // zod の内容(モデル出力を含みうる)は応答にもログにも出さない。種類だけ記録する。
      req.log.error({ errorName: 'ResponseSchemaMismatch' }, 'response validation failed');
      return sendError(reply, 502, 'analysis_failed');
    }
    return reply.send(parsed.data);
  });
}
