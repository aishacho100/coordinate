import { AnalyzeResponseSchema } from '@coordinate/shared';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { checkerJpeg, fakeDetector, flatPng, multipartBody } from '../test-utils';

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

  it('入力画素数の上限を超える画像は 400 invalid_image で、検出器を呼ばない', async () => {
    const detector = fakeDetector();
    const app = buildApp({ config, detector });
    // 上限(40_000_000 画素)を超える最小に近い寸法。単色 PNG なので小さい。
    const res = await post(app, await flatPng(6500, 6500, 128), { filename: 'big.png', contentType: 'image/png' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
    expect(detector.calls).toBe(0);
    await app.close();
  });

  describe('multipart の上限', () => {
    // 有効な JPEG を使う(壊れた画像による 400 と区別するため)。
    function rawMultipart(parts: (string | Buffer)[], boundary = '----lim') {
      const chunks: Buffer[] = [];
      for (const p of parts) chunks.push(Buffer.from(`--${boundary}\r\n`), Buffer.from(p), Buffer.from('\r\n'));
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
    }
    const filePart = (name: string, jpeg: Buffer) =>
      Buffer.concat([
        Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        jpeg,
      ]);
    const fieldPart = (name: string) => `Content-Disposition: form-data; name="${name}"\r\n\r\nv`;

    it('余計なフィールドを持つ multipart は 400(500 にしない)', async () => {
      const detector = fakeDetector();
      const app = buildApp({ config, detector });
      const { payload, headers } = rawMultipart([fieldPart('extra'), filePart('image', await checkerJpeg())]);
      const res = await app.inject({ method: 'POST', url: '/v1/analyze', payload, headers });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_image');
      expect(detector.calls).toBe(0);
      await app.close();
    });

    it('パートが多すぎる multipart は 400(500 にしない)', async () => {
      const detector = fakeDetector();
      const app = buildApp({ config, detector });
      const jpeg = await checkerJpeg();
      const { payload, headers } = rawMultipart([filePart('image', jpeg), filePart('b', jpeg), filePart('c', jpeg)]);
      const res = await app.inject({ method: 'POST', url: '/v1/analyze', payload, headers });
      expect(res.statusCode).toBe(400);
      expect(detector.calls).toBe(0);
      await app.close();
    });

    it('正常な 1 ファイルの multipart は 200', async () => {
      const app = buildApp({ config, detector: fakeDetector() });
      expect((await post(app, await checkerJpeg())).statusCode).toBe(200);
      await app.close();
    });
  });

  it('応答の組み立てが検証に失敗したら 502 analysis_failed(内容は返さない)', async () => {
    const detector = fakeDetector({ usage: { inputTokens: -5, outputTokens: 1 }, model: 'secret-model-name' });
    const app = buildApp({ config, detector });
    const res = await post(app, await checkerJpeg());
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('analysis_failed');
    expect(res.body).not.toContain('secret-model-name');
    await app.close();
  });
});
