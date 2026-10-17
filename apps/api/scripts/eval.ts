/**
 * 実 Claude を呼ぶ評価。手元のコーデ写真(apps/api/eval/photos/*.jpg|png)に対して、
 * 指定したモデルごとに検出を実行し、件数・ブランド採用数・トークン数・所要時間・概算費用を表にする。
 * キーが無ければ何もせず終了する。画像は API へ送るのみで、保存しない。
 *
 * 使い方: npm run eval -w api -- --models claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { loadConfig } from '../src/config';
import { ClaudeVisionDetector } from '../src/detector/claude-vision-detector';
import { prepareForModel } from '../src/image/prepare-image';
import { assessQuality } from '../src/image/quality';
import { validateImage } from '../src/image/validate-image';
import { estimateCostUsd } from '../src/usage';

function modelsFromArgs(fallback: string): string[] {
  const i = process.argv.indexOf('--models');
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return (value && !value.startsWith('--') ? value : fallback)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

async function main() {
  const config = loadConfig();
  if (!config.anthropicApiKey) {
    console.log('ANTHROPIC_API_KEY が未設定のため、評価をスキップしました。');
    return;
  }
  const models = modelsFromArgs(config.model);

  const dir = join(__dirname, '..', 'eval', 'photos');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
  } catch {
    // ディレクトリが無い
  }
  if (files.length === 0) {
    console.log(`写真がありません。${dir} にコーデ写真(JPEG/PNG)を置いてください(Git 管理外)。`);
    return;
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 120_000, maxRetries: 1 });
  const rows: Record<string, unknown>[] = [];
  const details: unknown[] = [];

  for (const file of files) {
    const data = readFileSync(join(dir, file));
    if (!validateImage(data).ok) {
      console.log(`${file}: JPEG/PNG ではないためスキップ`);
      continue;
    }
    const quality = await assessQuality(data);
    const prepared = await prepareForModel(data);
    for (const model of models) {
      const detector = new ClaudeVisionDetector(client, model, config.effort);
      const t = performance.now();
      try {
        const r = await detector.detect(prepared);
        const ms = Math.round(performance.now() - t);
        rows.push({
          file: file.slice(0, 18),
          model,
          quality: quality.issues.join('|') || '-',
          items: r.items.length,
          withBrand: r.items.filter((i) => i.brandCandidates.length > 0).length,
          fullBody: r.fullBody,
          inTok: r.usage.inputTokens,
          outTok: r.usage.outputTokens,
          ms,
          usd: estimateCostUsd(r.usage, config.pricing)?.toFixed(4) ?? '-',
        });
        details.push({
          file,
          model,
          fullBody: r.fullBody,
          items: r.items.map((i) => ({
            category: i.categoryId,
            box: i.box,
            brand: i.brandCandidates[0]?.name ?? null,
            visibleText: i.appearance.visibleText,
            level: i.level,
          })),
        });
      } catch (e) {
        // 画像・キー・上流の詳細は出さず、種類だけ記録する。
        rows.push({ file: file.slice(0, 18), model, error: e instanceof Error ? e.name : 'unknown' });
      }
    }
  }

  console.table(rows);
  const outDir = join(__dirname, '..', 'eval', 'results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ rows, details }, null, 2));
  console.log(`詳細: eval/results/${stamp}.json`);
}

void main();
