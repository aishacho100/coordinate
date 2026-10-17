import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Detector } from '@coordinate/shared';

import type { Config } from './config';
import { RATE_LIMIT_BODY, registerAnalyzeRoute } from './routes/analyze';

export type AppDeps = {
  config: Config;
  /** null ならキー未設定。解析は 503 を返す。 */
  detector: Detector | null;
  logger?: boolean;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.register(multipart, { limits: { fileSize: deps.config.maxImageBytes, files: 1 } });
  app.register(rateLimit, {
    global: false,
    max: deps.config.ratePerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, ...RATE_LIMIT_BODY }),
  });

  app.get('/health', async () => ({ ok: true, detectorConfigured: deps.detector !== null }));
  app.register(async (instance) => registerAnalyzeRoute(instance, deps));

  return app;
}
