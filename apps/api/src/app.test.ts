import { buildApp } from './app';
import { loadConfig } from './config';

describe('GET /health', () => {
  it('稼働状態と、検出器が設定済みかどうかを返す', async () => {
    const app = buildApp({ config: loadConfig({}), detector: null });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, detectorConfigured: false, identifyConfigured: false });
    await app.close();
  });
});

describe('キーなし環境での起動', () => {
  it('loadConfig({}) 相当でも buildApp が動き、識別は未設定として 503 を返す', async () => {
    const config = loadConfig({});
    expect(config.anthropicApiKey).toBeNull();
    expect(config.serpapiKey).toBeNull();
    expect(config.rakuten).toBeNull();
    const app = buildApp({ config, detector: null, identifier: null });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ ok: true, detectorConfigured: false, identifyConfigured: false });
    await app.close();
  });
});
