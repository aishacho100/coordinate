import sharp from 'sharp';

import type { DetectedItem, Detector, DetectorResult } from '@coordinate/shared';

/** 市松模様の JPEG。エッジが多く、明るさも十分なので品質評価を通る。 */
export async function checkerJpeg(width = 1000, height = 1000, cell = 8): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  // 大きい画像でも遅くならないよう、2 種類の行パターンを作って行ごとにコピーする。
  const rowA = Buffer.alloc(width);
  const rowB = Buffer.alloc(width);
  for (let x = 0; x < width; x++) {
    const even = Math.floor(x / cell) % 2 === 0;
    rowA[x] = even ? 220 : 40;
    rowB[x] = even ? 40 : 220;
  }
  for (let y = 0; y < height; y++) {
    (Math.floor(y / cell) % 2 === 0 ? rowA : rowB).copy(raw, y * width);
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).jpeg({ quality: 95 }).toBuffer();
}

export async function flatJpeg(width: number, height: number, value: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height, value);
  return sharp(raw, { raw: { width, height, channels: 1 } }).jpeg({ quality: 95 }).toBuffer();
}

export async function flatPng(width: number, height: number, value: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height, value);
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export function multipartBody(
  file: Buffer,
  opts: { field?: string; filename?: string; contentType?: string } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const { field = 'image', filename = 'photo.jpg', contentType = 'image/jpeg' } = opts;
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, file, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export const sampleItem: DetectedItem = {
  id: 'item_1',
  categoryId: 'tshirt',
  box: { x: 0.3, y: 0.25, w: 0.4, h: 0.3 },
  appearance: { colors: ['白'], visibleText: [] },
  brandCandidates: [],
  candidates: [],
  confidence: { detection: 0.9, category: 0.9, brand: null, model: null, variant: null, price: null },
  level: 'unidentified',
  reviewState: 'auto',
  rationale: 'ブランドを示す文字・ロゴが確認できませんでした',
  modelVersion: 'test-model',
};

/** Claude を呼ばない偽の検出器。呼び出し回数を数える。 */
export function fakeDetector(partial: Partial<DetectorResult> = {}): Detector & { calls: number } {
  const result: DetectorResult = {
    items: [sampleItem],
    fullBody: true,
    model: 'test-model',
    usage: { inputTokens: 1200, outputTokens: 300 },
    ...partial,
  };
  const d = {
    calls: 0,
    async detect() {
      d.calls += 1;
      return result;
    },
  };
  return d;
}
