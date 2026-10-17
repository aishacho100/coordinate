import { buildApp } from './app';
import { loadConfig } from './config';

describe('GET /health', () => {
  it('稼働状態と、検出器が設定済みかどうかを返す', async () => {
    const app = buildApp({ config: loadConfig({}), detector: null });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, detectorConfigured: false });
    await app.close();
  });
});
