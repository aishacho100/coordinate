import { IdentifyResponseSchema, type IdentifyResponse } from '@coordinate/shared';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { SearchUnavailableError } from '../identify/identifier';
import { checkerJpeg, sampleItem } from '../test-utils';
import { FileUsageStore } from '../usage/usage-store';

const config = loadConfig({});
const response: IdentifyResponse = {
  itemId: 'item_1',
  verdict: 'unidentified',
  level: 'unidentified',
  rationale: '手がかりが足りず、商品を特定できませんでした',
  candidates: [],
  searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
  comparison: 'skipped',
  queries: ['q'],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 1, lensSearches: 1 },
  estimatedCostUsd: null,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  timings: { total: 5 },
};
type UsageOpts = { onUsage?: (u: { inputTokens: number; outputTokens: number }) => void };
const fakeIdentifier = (impl?: (opts: UsageOpts) => Promise<IdentifyResponse>) => {
  const f = {
    calls: 0,
    identify: async (_i: unknown, _item: unknown, opts: UsageOpts = {}) => ((f.calls += 1), impl ? impl(opts) : response),
  };
  return f;
};

function body(image: Buffer, fields: Record<string, string>, extraFile = false) {
  const b = '----t' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="c.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from('\r\n'));
  if (extraFile) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="d.jpg"\r\nContent-Type: image/jpeg\r\n\r\nxx\r\n`));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

const post = (app: ReturnType<typeof buildApp>, image: Buffer, fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const { payload, headers: h } = body(image, fields);
  return app.inject({ method: 'POST', url: '/v1/identify', payload, headers: { ...h, ...headers } });
};
const itemJson = JSON.stringify(sampleItem);
const install = { 'x-install-id': 'abcdef0123456789abcdef' };

describe('POST /v1/identify', () => {
  it('正常: 検証済みの応答を返す', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(200);
    expect(IdentifyResponseSchema.parse(res.json()).verdict).toBe('unidentified');
    expect(identifier.calls).toBe(1);
    await app.close();
  });
  it('x-image-search-consent が文字列 "1" のときだけ consent=true を渡す', async () => {
    const seen: unknown[] = [];
    const identifier = {
      identify: async (_i: unknown, _item: unknown, opts: { consent?: boolean } = {}) => (seen.push(opts.consent), response),
    };
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    for (const h of <Record<string, string>[]>[{ 'x-image-search-consent': '1' }, {}, { 'x-image-search-consent': '0' }, { 'x-image-search-consent': 'true' }]) {
      expect((await post(app, img, { item: itemJson }, { ...install, ...h })).statusCode).toBe(200);
    }
    expect(seen).toEqual([true, false, false, false]);
    await app.close();
  });
  it('識別器が無ければ 503 not_configured', async () => {
    const app = buildApp({ config, detector: null, identifier: null, usageStore: new FileUsageStore(null) });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('not_configured');
    await app.close();
  });
  it('item が無い・壊れている・形が違うなら 400 invalid_request。識別器を呼ばない', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    for (const f of [{} as Record<string, string>, { item: '{not json' }, { item: JSON.stringify({ id: 'x' }) }]) {
      const res = await post(app, img, f, install);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_request');
    }
    expect(identifier.calls).toBe(0);
    await app.close();
  });
  it('item のフィールドが 32KB を超えたら 400 invalid_request。識別器を呼ばない', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const res = await post(app, await checkerJpeg(), { item: itemJson + ' '.repeat(40 * 1024) }, install);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
    expect(identifier.calls).toBe(0);
    await app.close();
  });
  it('item が各フィールドの上限を超えていたら 400 invalid_request', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const big = { ...sampleItem, appearance: { ...sampleItem.appearance, visibleText: Array(31).fill('a') } };
    const res = await post(app, await checkerJpeg(), { item: JSON.stringify(big) }, install);
    expect(res.statusCode).toBe(400);
    expect(identifier.calls).toBe(0);
    await app.close();
  });
  it('失敗した処理でも、onUsage で通知された Claude の使用量を月間に計上する', async () => {
    const store = new FileUsageStore(null);
    const identifier = fakeIdentifier(async (opts) => {
      opts.onUsage?.({ inputTokens: 100, outputTokens: 10 });
      throw new SearchUnavailableError();
    });
    const app = buildApp({ config, detector: null, identifier, usageStore: store });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(503);
    expect(store.monthly(new Date())).toMatchObject({ claudeInput: 100, claudeOutput: 10 });
    await app.close();
  });
  it('成功時は onUsage の分だけを計上し、二重計上しない', async () => {
    const store = new FileUsageStore(null);
    const identifier = fakeIdentifier(async (opts) => {
      opts.onUsage?.({ inputTokens: 5, outputTokens: 3 });
      return response;
    });
    const app = buildApp({ config, detector: null, identifier, usageStore: store });
    expect((await post(app, await checkerJpeg(), { item: itemJson }, install)).statusCode).toBe(200);
    expect(store.monthly(new Date())).toMatchObject({ claudeInput: 5, claudeOutput: 3 });
    await app.close();
  });
  it('日次の上限の記録が例外を投げたら、上限を確認できないので 503 identify_failed。識別器を呼ばない', async () => {
    const real = new FileUsageStore(null);
    const broken = {
      monthly: real.monthly.bind(real),
      addMonthly: real.addMonthly.bind(real),
      tryConsumeDaily: () => {
        throw new Error('disk full');
      },
    } as unknown as FileUsageStore;
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: broken });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('identify_failed');
    expect(identifier.calls).toBe(0);
    await app.close();
  });
  it('月間の計上が例外を投げても、結果の返却を妨げない', async () => {
    const real = new FileUsageStore(null);
    const broken = {
      monthly: real.monthly.bind(real),
      addMonthly: () => {
        throw new Error('disk full');
      },
      tryConsumeDaily: real.tryConsumeDaily.bind(real),
    } as unknown as FileUsageStore;
    const identifier = fakeIdentifier(async (opts) => {
      opts.onUsage?.({ inputTokens: 5, outputTokens: 3 });
      return response;
    });
    const app = buildApp({ config, detector: null, identifier, usageStore: broken });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(200);
    expect(IdentifyResponseSchema.parse(res.json()).verdict).toBe('unidentified');
    await app.close();
  });
  it('画像でないファイルは 400 invalid_image', async () => {
    const app = buildApp({ config, detector: null, identifier: fakeIdentifier(), usageStore: new FileUsageStore(null) });
    const res = await post(app, Buffer.from('not an image'), { item: itemJson }, install);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
    await app.close();
  });
  it('item 以外のフィールドや、ファイルの追加は拒否する', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    expect((await post(app, img, { item: itemJson, extra: 'x' }, install)).statusCode).toBe(400);
    expect((await post(app, img, { other: 'x' }, install)).statusCode).toBe(400);
    const { payload, headers } = body(img, { item: itemJson }, true);
    expect((await app.inject({ method: 'POST', url: '/v1/identify', payload, headers: { ...headers, ...install } })).statusCode).toBe(400);
    expect(identifier.calls).toBe(0);
    await app.close();
  });
  it('1 日の上限を超えたら 429 quota_exceeded。識別器を呼ばない', async () => {
    const identifier = fakeIdentifier();
    const cfg = { ...config, limits: { ...config.limits, identifyPerInstallPerDay: 1 } };
    const app = buildApp({ config: cfg, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    expect((await post(app, img, { item: itemJson }, install)).statusCode).toBe(200);
    const second = await post(app, img, { item: itemJson }, install);
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toBe('quota_exceeded');
    expect(identifier.calls).toBe(1);
    await app.close();
  });
  it('検索が使えないなら 503 search_unavailable、それ以外の失敗は 502 identify_failed', async () => {
    const mk = (impl: () => Promise<IdentifyResponse>) =>
      buildApp({ config, detector: null, identifier: fakeIdentifier(impl), usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    const a = mk(async () => {
      throw new SearchUnavailableError();
    });
    const ra = await post(a, img, { item: itemJson }, install);
    expect([ra.statusCode, ra.json().error]).toEqual([503, 'search_unavailable']);
    const b = mk(async () => {
      throw new Error('boom');
    });
    const rb = await post(b, img, { item: itemJson }, install);
    expect([rb.statusCode, rb.json().error]).toEqual([502, 'identify_failed']);
    await a.close();
    await b.close();
  });
});
