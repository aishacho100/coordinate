import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Detector } from '@coordinate/shared';

import type { Config } from './config';
import type { Identifier } from './identify/identifier';
import { RATE_LIMIT_BODY, registerAnalyzeRoute } from './routes/analyze';
import { registerIdentifyRoute } from './routes/identify';
import type { UsageStore } from './usage/usage-store';

export type AppDeps = {
  config: Config;
  /** null ならキー未設定。解析は 503 を返す。 */
  detector: Detector | null;
  /** null なら /v1/identify は 503。 */
  identifier?: Pick<Identifier, 'identify'> | null;
  usageStore?: UsageStore;
  logger?: boolean;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.register(multipart, { limits: { fileSize: deps.config.maxImageBytes, files: 1, fields: 0, parts: 2 } });
  app.register(rateLimit, {
    global: false,
    max: deps.config.ratePerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, ...RATE_LIMIT_BODY }),
  });

  app.get('/health', async () => ({ ok: true, detectorConfigured: deps.detector !== null, identifyConfigured: !!deps.identifier }));
  app.register(async (instance) => registerAnalyzeRoute(instance, deps));
  app.register(async (instance) => registerIdentifyRoute(instance, deps));

  return app;
}
