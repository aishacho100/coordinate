import { AnalyzeResponseSchema } from '@coordinate/shared';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { checkerJpeg, fakeDetector, multipartBody } from '../test-utils';

const config = loadConfig({});

async function post(app: ReturnType<typeof buildApp>, file: Buffer, opts?: Parameters<typeof multipartBody>[1]) {
  const { payload, headers } = multipartBody(file, opts);
  return app.inject({ method: 'POST', url: '/v1/analyze', payload, headers });
}

describe('POST /v1/analyze', () => {
  it('正常: 品質・検出結果・使用量・所要時間を返す', async () => {
    const detector = fakeDetector();
    const app = buildApp({ config, detector });
    const res = await post(app, await checkerJpeg());
    expect(res.statusCode).toBe(200);
    const body = AnalyzeResponseSchema.parse(res.json());
    expect(body.items).toHaveLength(1);
    expect(body.quality).toEqual({ ok: true, issues: [] });
    expect(body.model).toBe('test-model');
    expect(body.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(body.timings.total).toBeGreaterThanOrEqual(body.timings.detect);
    expect(detector.calls).toBe(1);
    await app.close();
  });

  it('全身が写っていなければ not_full_body を助言に加える(検出結果は返す)', async () => {
    const app = buildApp({ config, detector: fakeDetector({ fullBody: false }) });
    const body = (await post(app, await checkerJpeg())).json();
    expect(body.quality).toEqual({ ok: false, issues: ['not_full_body'] });
    expect(body.items).toHaveLength(1);
    await app.close();
  });

  it('画像でないファイルは 400 invalid_image で、検出器を呼ばない', async () => {
    const detector = fakeDetector();
    const app = buildApp({ config, detector });
    const res = await post(app, Buffer.from('not an image'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
    expect(detector.calls).toBe(0);
    await app.close();
  });

  it('ファイルが無ければ 400 invalid_image', async () => {
    const app = buildApp({ config, detector: fakeDetector() });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analyze',
      payload: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
    await app.close();
  });

  it('サイズ上限を超えると 400 too_large', async () => {
    const small = { ...config, maxImageBytes: 1000 };
    const detector = fakeDetector();
    const app = buildApp({ config: small, detector });
    const res = await post(app, await checkerJpeg(600, 600));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('too_large');
    expect(detector.calls).toBe(0);
    await app.close();
  });

  it('マジックバイトは正しいが壊れた画像は 400 invalid_image', async () => {
    const app = buildApp({ config, detector: fakeDetector() });
    const res = await post(app, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
    await app.close();
  });

  it('キー未設定(検出器なし)は 503 not_configured', async () => {
    const app = buildApp({ config, detector: null });
    const res = await post(app, await checkerJpeg());
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('not_configured');
    await app.close();
  });

  it('検出器が失敗したら 502 analysis_failed(内部の詳細は返さない)', async () => {
    const detector = { detect: jest.fn().mockRejectedValue(new Error('secret upstream detail')) };
    const app = buildApp({ config, detector });
    const res = await post(app, await checkerJpeg());
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('analysis_failed');
    expect(res.body).not.toContain('secret');
    await app.close();
  });

  it('IP ごとの回数上限を超えると 429 rate_limited', async () => {
    const app = buildApp({ config: { ...config, ratePerMinute: 2 }, detector: fakeDetector() });
    const img = await checkerJpeg(800, 800);
    expect((await post(app, img)).statusCode).toBe(200);
    expect((await post(app, img)).statusCode).toBe(200);
    const third = await post(app, img);
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toBe('rate_limited');
    await app.close();
  });
});
