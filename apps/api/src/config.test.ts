import { loadConfig } from './config';

describe('loadConfig', () => {
  it('未設定なら既定値とキー無し(null)になる', () => {
    const c = loadConfig({});
    expect(c.anthropicApiKey).toBeNull();
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(c.effort).toBe('medium');
    expect(c.port).toBe(8787);
    expect(c.maxImageBytes).toBe(10 * 1024 * 1024);
    expect(c.ratePerMinute).toBe(20);
    expect(c.pricing).toBeNull();
  });

  it('空文字のキーは未設定として扱う', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: '  ' }).anthropicApiKey).toBeNull();
  });

  it('環境変数を読み取る', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-haiku-5-5',
      ANTHROPIC_EFFORT: 'low',
      PORT: '9000',
      RATE_LIMIT_PER_MINUTE: '5',
      PRICE_INPUT_PER_MTOK: '2',
      PRICE_OUTPUT_PER_MTOK: '10',
    });
    expect(c).toMatchObject({
      anthropicApiKey: 'k',
      model: 'claude-haiku-5-5',
      effort: 'low',
      port: 9000,
      ratePerMinute: 5,
      pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    });
  });

  it('不正な effort・数値は既定値に戻す', () => {
    const c = loadConfig({ ANTHROPIC_EFFORT: 'turbo', PORT: 'abc', PRICE_INPUT_PER_MTOK: '2' });
    expect(c.effort).toBe('medium');
    expect(c.port).toBe(8787);
    expect(c.pricing).toBeNull(); // 片方だけでは概算しない
  });
});

describe('loadConfig: 商品検索', () => {
  it('未設定なら検索は使えず、上限は既定値', () => {
    const c = loadConfig({});
    expect(c.serpapiKey).toBeNull();
    expect(c.lensEnabled).toBe(false);
    expect(c.rakuten).toBeNull();
    expect(c.limits).toEqual({
      searchesPerProviderPerItem: 2,
      cacheTtlMs: 3_600_000,
      identifyPerInstallPerDay: 30,
      identifyPerIpPerDay: 90,
      serpapiMonthly: 200,
      searchTimeoutMs: 15_000,
      lensUploadTimeoutMs: 15_000,
      lensSearchTimeoutMs: 45_000,
    });
    expect(c.serpapiCostPerSearchUsd).toBeNull();
    expect(c.usageFile).toBe('data/usage.json');
  });
  it('SERPAPI_API_KEY があれば lensEnabled が true になる', () => {
    expect(loadConfig({ SERPAPI_API_KEY: 's' }).lensEnabled).toBe(true);
    expect(loadConfig({ SERPAPI_API_KEY: '  ' }).lensEnabled).toBe(false);
  });
  it('楽天は applicationId と accessKey がそろったときだけ有効(affiliateId は任意)', () => {
    expect(loadConfig({ RAKUTEN_APPLICATION_ID: 'a' }).rakuten).toBeNull();
    expect(loadConfig({ RAKUTEN_APPLICATION_ID: 'a', RAKUTEN_ACCESS_KEY: 'k' }).rakuten).toEqual({
      applicationId: 'a',
      accessKey: 'k',
      affiliateId: null,
    });
    expect(
      loadConfig({ RAKUTEN_APPLICATION_ID: 'a', RAKUTEN_ACCESS_KEY: 'k', RAKUTEN_AFFILIATE_ID: 'x' }).rakuten
        ?.affiliateId,
    ).toBe('x');
  });
  it('数値の設定を読む。不正な値は既定値に戻す', () => {
    const c = loadConfig({
      SERPAPI_API_KEY: 's',
      SERPAPI_MONTHLY_LIMIT: '100',
      SEARCH_CACHE_TTL_SECONDS: '60',
      SERPAPI_COST_PER_SEARCH_USD: '0.025',
      IDENTIFY_DAILY_LIMIT: 'abc',
    });
    expect(c.serpapiKey).toBe('s');
    expect(c.limits.serpapiMonthly).toBe(100);
    expect(c.limits.cacheTtlMs).toBe(60_000);
    expect(c.serpapiCostPerSearchUsd).toBe(0.025);
    expect(c.limits.identifyPerInstallPerDay).toBe(30);
    expect(c.limits.identifyPerIpPerDay).toBe(90);
  });
  it('検索キャッシュの保持時間は最大 3600 秒に収める(楽天の規約: メモリ上の短時間のみ)', () => {
    expect(loadConfig({ SEARCH_CACHE_TTL_SECONDS: '86400' }).limits.cacheTtlMs).toBe(3_600_000);
    expect(loadConfig({ SEARCH_CACHE_TTL_SECONDS: '3600' }).limits.cacheTtlMs).toBe(3_600_000);
    expect(loadConfig({}).limits.cacheTtlMs).toBe(3_600_000);
  });
  it('Lens のタイムアウトは秒で指定でき、不正な値は既定値、上限は 120 秒', () => {
    const c = loadConfig({ LENS_UPLOAD_TIMEOUT_SECONDS: '20', LENS_SEARCH_TIMEOUT_SECONDS: '60' });
    expect(c.limits.lensUploadTimeoutMs).toBe(20_000);
    expect(c.limits.lensSearchTimeoutMs).toBe(60_000);
    const bad = loadConfig({ LENS_UPLOAD_TIMEOUT_SECONDS: '-1', LENS_SEARCH_TIMEOUT_SECONDS: 'abc' });
    expect(bad.limits.lensUploadTimeoutMs).toBe(15_000);
    expect(bad.limits.lensSearchTimeoutMs).toBe(45_000);
    expect(loadConfig({ LENS_SEARCH_TIMEOUT_SECONDS: '999' }).limits.lensSearchTimeoutMs).toBe(120_000);
  });
});
