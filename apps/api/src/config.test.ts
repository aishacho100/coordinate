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
