import { AnalyzeError, analyzePhoto, ERROR_MESSAGES } from '@/lib/analyze-api';

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
    }
  },
}));
const { File: MockFile } = jest.requireMock<{ File: new (uri: string) => { uri: string } }>('expo-file-system');

const okBody = {
  quality: { ok: true, issues: [] },
  items: [],
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 10, outputTokens: 5 },
  timings: { quality: 10, detect: 20, total: 31 },
};

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const opts = (fetchImpl: jest.Mock) => ({ baseUrl: 'http://api.test', fetchImpl: fetchImpl as unknown as typeof fetch });

describe('analyzePhoto', () => {
  it('成功時はスキーマ検証したレスポンスを返し、/v1/analyze へ POST する', async () => {
    const f = jest.fn().mockResolvedValue(json(200, okBody));
    const res = await analyzePhoto('file:///a.jpg', opts(f));
    expect(res.model).toBe('claude-sonnet-5-5');
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/v1/analyze');
    expect(f.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('写真は expo-file-system の File(Blob 互換)として添付する(グローバル fetch は {uri} 形式を受け付けない)', async () => {
    const append = jest.spyOn(FormData.prototype, 'append');
    const f = jest.fn().mockResolvedValue(json(200, okBody));
    await analyzePhoto('file:///a.jpg', opts(f));
    const call = append.mock.calls.find(([name]) => name === 'image');
    expect(call?.[1]).toBeInstanceOf(MockFile);
    expect((call?.[1] as unknown as { uri: string }).uri).toBe('file:///a.jpg');
    append.mockRestore();
  });

  it.each([
    [400, 'invalid_image'],
    [400, 'too_large'],
    [503, 'not_configured'],
    [429, 'rate_limited'],
    [502, 'analysis_failed'],
  ])('HTTP %i / %s を AnalyzeError に変換する', async (status, error) => {
    const f = jest.fn().mockResolvedValue(json(status, { error, message: 'x' }));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: error });
  });

  it('本文が不明な失敗は analysis_failed', async () => {
    const f = jest.fn().mockResolvedValue(json(500, { oops: true }));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: 'analysis_failed' });
  });

  it('スキーマに合わない成功レスポンスは analysis_failed(成功として扱わない)', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { items: 'x' }));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: 'analysis_failed' });
  });

  it('通信できなければ network', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: 'network' });
  });

  it('API の URL が未設定なら not_configured', async () => {
    const prev = process.env.EXPO_PUBLIC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    await expect(analyzePhoto('file:///a.jpg', { fetchImpl: jest.fn() as unknown as typeof fetch })).rejects.toMatchObject({
      kind: 'not_configured',
    });
    if (prev !== undefined) process.env.EXPO_PUBLIC_API_BASE_URL = prev;
  });

  it('全種類のエラーに利用者向けの文言がある(開発者向けの文言を出さない)', () => {
    for (const msg of Object.values(ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/ANTHROPIC|\.env|API_KEY/);
    }
    expect(new AnalyzeError('network').kind).toBe('network');
  });
});
