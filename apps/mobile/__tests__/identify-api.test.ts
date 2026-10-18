import type { DetectedItem, IdentifyResponse } from '@coordinate/shared';

import { AnalyzeError } from '@/lib/analyze-api';
import { identifyItem } from '@/lib/identify-api';

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
    }
  },
  Paths: { document: 'file:///doc/' },
}));
const { File: MockFile } = jest.requireMock<{ File: new (uri: string) => { uri: string } }>('expo-file-system');

const sampleDetected: DetectedItem = {
  id: 'item_1',
  categoryId: 'sneakers',
  box: { x: 0.2, y: 0.5, w: 0.3, h: 0.3 },
  appearance: { colors: ['white'], visibleText: ['NIKE'] },
  brandCandidates: [{ name: 'NIKE', score: 0.8 }],
  candidates: [],
  confidence: { detection: 0.9, category: 0.9, brand: 0.8, model: null, variant: null, price: null },
  level: 'low',
  reviewState: 'auto',
  rationale: '',
  modelVersion: 'm',
};

const sampleIdentify: IdentifyResponse = {
  itemId: 'item_1',
  verdict: 'candidates',
  level: 'low',
  rationale: '候補は見つかりましたが、同じ商品とは確認できませんでした',
  candidates: [
    {
      product: {
        source: 'google_shopping',
        productId: 'p1',
        brand: '',
        name: 'NIKE Air Force 1',
        pageUrl: 'https://www.google.com/search?ibp=oshop&q=x',
        imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:a',
        price: { amount: 16500, currency: 'JPY', kind: 'market', fetchedAt: '2026-10-18T00:00:00.000Z' },
        fetchedAt: '2026-10-18T00:00:00.000Z',
      },
      matchScore: 0.6,
      matchType: 'similar',
      matched: ['色'],
      unconfirmed: ['型番'],
    },
  ],
  searches: { serpapi: 'ok', rakuten: 'ok' },
  comparison: 'done',
  queries: ['NIKE スニーカー 白'],
  usage: { claude: { inputTokens: 10, outputTokens: 5 }, serpapiSearches: 1, rakutenCalls: 1 },
  estimatedCostUsd: 0.01,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  timings: { total: 1200 },
};

const ID = 'abcdef0123456789abcdef';
const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const opts = (fetchImpl: jest.Mock) => ({
  baseUrl: 'http://x',
  installId: ID,
  fetchImpl: fetchImpl as unknown as typeof fetch,
});

describe('identifyItem', () => {
  afterEach(() => jest.restoreAllMocks());

  it('image と item(JSON)と x-install-id を送り、検証済みの応答を返す', async () => {
    const append = jest.spyOn(FormData.prototype, 'append');
    const f = jest.fn().mockResolvedValue(res(200, sampleIdentify));
    const r = await identifyItem('file:///c.jpg', sampleDetected, opts(f));
    expect(r.verdict).toBe(sampleIdentify.verdict);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe('http://x/v1/identify');
    expect(init.method).toBe('POST');
    expect(init.headers['x-install-id']).toBe(ID);
    const item = append.mock.calls.find(([name]) => name === 'item');
    expect(item?.[1]).toBe(JSON.stringify(sampleDetected));
    const image = append.mock.calls.find(([name]) => name === 'image');
    expect(image?.[1]).toBeInstanceOf(MockFile);
    expect((image?.[1] as unknown as { uri: string }).uri).toBe('file:///c.jpg');
  });

  it('エラー応答はコードを AnalyzeError にする', async () => {
    const f = jest.fn().mockResolvedValue(res(429, { error: 'quota_exceeded', message: 'm' }));
    const p = identifyItem('f', sampleDetected, opts(f));
    await expect(p).rejects.toBeInstanceOf(AnalyzeError);
    await expect(p).rejects.toMatchObject({ kind: 'quota_exceeded' });
  });

  it('不正な応答は identify_failed、通信失敗は network', async () => {
    await expect(
      identifyItem('f', sampleDetected, opts(jest.fn().mockResolvedValue(res(200, {})))),
    ).rejects.toMatchObject({ kind: 'identify_failed' });
    await expect(
      identifyItem('f', sampleDetected, opts(jest.fn().mockRejectedValue(new Error('x')))),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('ベース URL が無ければ not_configured', async () => {
    await expect(identifyItem('f', sampleDetected, { baseUrl: '', installId: ID })).rejects.toMatchObject({
      kind: 'not_configured',
    });
  });
});
