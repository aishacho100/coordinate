import Anthropic from '@anthropic-ai/sdk';

import { buildApp } from './app';
import { loadConfig } from './config';
import { ClaudeVisionDetector } from './detector/claude-vision-detector';

const config = loadConfig();
const detector = config.anthropicApiKey
  ? new ClaudeVisionDetector(
      new Anthropic({ apiKey: config.anthropicApiKey, timeout: 60_000, maxRetries: 1 }),
      config.model,
      config.effort,
    )
  : null;

const app = buildApp({ config, detector, logger: true });
if (!detector) app.log.warn('ANTHROPIC_API_KEY が未設定です。/v1/analyze は 503 を返します。');

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
