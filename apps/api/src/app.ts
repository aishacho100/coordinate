import Fastify, { type FastifyInstance } from 'fastify';

import type { Detector } from '@coordinate/shared';

import type { Config } from './config';

export type AppDeps = {
  config: Config;
  /** null ならキー未設定。解析は 503 を返す。 */
  detector: Detector | null;
  logger?: boolean;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.get('/health', async () => ({ ok: true, detectorConfigured: deps.detector !== null }));

  return app;
}
