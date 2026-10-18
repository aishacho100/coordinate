import type { FastifyInstance } from 'fastify';

import { DetectedItemSchema, IdentifyResponseSchema, type DetectorImage } from '@coordinate/shared';

import type { AppDeps } from '../app';
import { SearchUnavailableError } from '../identify/identifier';
import { validateImage } from '../image/validate-image';
import { prepareForModel } from '../image/prepare-image';
import { FileUsageStore } from '../usage/usage-store';
import { sendError } from './analyze';

/** item フィールド(JSON 文字列)の最大バイト数。 */
const ITEM_FIELD_MAX_BYTES = 32 * 1024;
const INSTALL_ID = /^[A-Za-z0-9-]{16,64}$/;

export function registerIdentifyRoute(app: FastifyInstance, deps: AppDeps) {
  const store = deps.usageStore ?? new FileUsageStore(null);

  app.post('/v1/identify', { config: { rateLimit: {} } }, async (req, reply) => {
    let data: Buffer | undefined;
    let itemRaw: string | undefined;
    try {
      // item(JSON 文字列)1 つとファイル 1 つだけを受け付ける。
      for await (const part of req.parts({ limits: { fields: 1, files: 1, parts: 2, fileSize: deps.config.maxImageBytes, fieldSize: ITEM_FIELD_MAX_BYTES } })) {
        if (part.type === 'file') {
          if (data) return sendError(reply, 400, 'invalid_image');
          data = await part.toBuffer();
          if (part.file.truncated) return sendError(reply, 400, 'too_large');
        } else {
          if (part.fieldname !== 'item' || itemRaw !== undefined) return sendError(reply, 400, 'invalid_request');
          if (part.valueTruncated) return sendError(reply, 400, 'invalid_request');
          itemRaw = typeof part.value === 'string' ? part.value : undefined;
        }
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'FST_REQ_FILE_TOO_LARGE'
        ? sendError(reply, 400, 'too_large')
        : sendError(reply, 400, 'invalid_request');
    }
    if (!data) return sendError(reply, 400, 'invalid_image');
    if (!validateImage(data).ok) return sendError(reply, 400, 'invalid_image');

    let item;
    try {
      const parsed = DetectedItemSchema.safeParse(JSON.parse(itemRaw ?? ''));
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');
      item = parsed.data;
    } catch {
      return sendError(reply, 400, 'invalid_request');
    }
    if (!deps.identifier) return sendError(reply, 503, 'not_configured');

    // 利用回数の上限(認証ではない。インストール ID と IP の両方で数える)。
    const now = new Date();
    const header = req.headers['x-install-id'];
    const installId = typeof header === 'string' && INSTALL_ID.test(header) ? header : null;
    const { identifyPerInstallPerDay, identifyPerIpPerDay } = deps.config.limits;
    // 記録の失敗(ディスクなど)で結果を妨げない。種類だけログに残す。
    const safely = <T>(label: string, fn: () => T, fallback: T): T => {
      try {
        return fn();
      } catch (e) {
        req.log.error({ errorName: e instanceof Error ? e.name : 'unknown' }, label);
        return fallback;
      }
    };
    if (
      !safely('daily limit (ip) failed', () => store.tryConsumeDaily(now, 'ip', req.ip, identifyPerIpPerDay), true) ||
      (installId &&
        !safely('daily limit (install) failed', () => store.tryConsumeDaily(now, 'install', installId, identifyPerInstallPerDay), true))
    ) {
      return sendError(reply, 429, 'quota_exceeded');
    }

    let image: DetectorImage;
    try {
      image = await prepareForModel(data);
    } catch {
      return sendError(reply, 400, 'invalid_image');
    }

    let result;
    try {
      // Claude の使用量は、応答を受け取るたびに計上する(後続の処理が失敗しても課金されるため)。
      result = await deps.identifier.identify(image, item, {
        onUsage: (u) =>
          safely('monthly usage failed', () => store.addMonthly(now, { claudeInput: u.inputTokens, claudeOutput: u.outputTokens }), undefined),
      });
    } catch (e) {
      // 画像・キー・検索語・上流の詳細はログに残さない。種類だけ記録する。
      req.log.error({ errorName: e instanceof Error ? e.name : 'unknown', status: (e as { status?: number }).status }, 'identify failed');
      return e instanceof SearchUnavailableError
        ? sendError(reply, 503, 'search_unavailable')
        : sendError(reply, 502, 'identify_failed');
    }

    req.log.info(
      {
        verdict: result.verdict,
        searches: result.searches,
        comparison: result.comparison,
        usage: result.usage,
        estimatedCostUsd: result.estimatedCostUsd,
      },
      'identified',
    );

    const parsed = IdentifyResponseSchema.safeParse(result);
    if (!parsed.success) {
      req.log.error({ errorName: 'ResponseSchemaMismatch' }, 'response validation failed');
      return sendError(reply, 502, 'identify_failed');
    }
    return reply.send(parsed.data);
  });
}
