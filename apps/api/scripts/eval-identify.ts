/**
 * 実 API を呼ぶ「商品特定」の評価。手元のコーデ写真(apps/api/eval/photos/*.jpg|png)から、
 * 検出 → 切り抜き → 商品特定(SerpApi・楽天・Claude の照合)を実行し、判定(A/B/C)・原価・検索回数を表にする。
 * ANTHROPIC_API_KEY が無ければ何もせず終了する。SerpApi・楽天のキーが無いときは、使えない検索が表に明示される。
 * 画像は API へ送るのみで、保存しない。エラーは種類だけを表示し、キー・画像・検索語の全文は出さない。
 *
 * 使い方: npm run eval:identify -w api -- --max-searches 40 [--photos a,b]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import type { DetectedItem, IdentifyResponse, Product } from '@coordinate/shared';

import { TtlCache } from '../src/cache/ttl-cache';
import { loadConfig } from '../src/config';
import { ClaudeVisionDetector } from '../src/detector/claude-vision-detector';
import { containsWholeWords } from '../src/detector/normalize';
import { Comparer } from '../src/identify/comparer';
import { fetchImage } from '../src/search/fetch-image';
import { Identifier } from '../src/identify/identifier';
import { QueryGenerator } from '../src/identify/query-generator';
import { cropRect } from '../src/image/crop-rect';
import { prepareForModel } from '../src/image/prepare-image';
import { validateImage } from '../src/image/validate-image';
import { prepareForLens } from '../src/image/prepare-lens';
import { LensSearcher } from '../src/search/lens';
import { RakutenSearcher } from '../src/search/rakuten';
import { SerpApiSearcher } from '../src/search/serpapi';
import { estimateCostUsd } from '../src/usage';
import { FileUsageStore } from '../src/usage/usage-store';

const DEFAULT_MAX_SEARCHES = 40;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function maxSearchesFromArgs(): number {
  const n = Number(argValue('--max-searches'));
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_SEARCHES;
}

function photoFilterFromArgs(): string[] {
  return (argValue('--photos') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function main() {
  const config = loadConfig();
  if (!config.anthropicApiKey) {
    console.log('ANTHROPIC_API_KEY が未設定のため、評価をスキップしました。');
    return;
  }
  const maxSearches = maxSearchesFromArgs();
  const filter = photoFilterFromArgs();
  console.log(`SerpApi キー: ${config.serpapiKey ? '設定あり' : '未設定(Google Shopping は使えません)'}`);
  console.log(
    `楽天キー: ${config.rakuten ? '設定あり' : '未設定(楽天は使えません)'} / アフィリエイト ID: ${config.rakuten?.affiliateId ? '設定あり' : '未設定'}`,
  );
  console.log(`SerpApi の検索の上限(この実行): ${maxSearches} 回`);
  const consent = process.env.EVAL_CONSENT === '1';
  console.log(`画像検索(Lens): ${consent ? '同意あり(EVAL_CONSENT=1)' : '同意なし(使いません。使うには EVAL_CONSENT=1)'}`);

  const dir = join(__dirname, '..', 'eval', 'photos');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
  } catch {
    // ディレクトリが無い
  }
  if (filter.length > 0) files = files.filter((f) => filter.some((p) => f.toLowerCase().includes(p)));
  if (files.length === 0) {
    console.log(`対象の写真がありません。${dir} にコーデ写真(JPEG/PNG)を置いてください(Git 管理外)。`);
    return;
  }

  // server.ts と同じ組み立て。使用量はメモリのみ。SerpApi は --max-searches に達すると budget_exhausted になる。
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 120_000, maxRetries: 1 });
  const detector = new ClaudeVisionDetector(anthropic, config.model, config.effort);
  const usageStore = new FileUsageStore(null);
  const cache = () => new TtlCache<Product[]>({ ttlMs: config.limits.cacheTtlMs, maxEntries: 500 });
  const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => fetch(url, init);
  const identifier = new Identifier({
    queryGenerator: new QueryGenerator(anthropic, config.model, config.effort),
    comparer: new Comparer(anthropic, config.model, config.effort, (url) => fetchImage(url, { fetchImpl: fetch })),
    // 画像検索は EVAL_CONSENT=1 のときだけ実行する(consent を渡す)。Lens の呼び出しも --max-searches に含まれる。
    lens: config.lensEnabled
      ? new LensSearcher({
          apiKey: config.serpapiKey,
          fetchImpl: (url, init) => fetch(url, init),
          cache: cache(),
          store: usageStore,
          monthlyLimit: maxSearches,
          timeoutMs: config.limits.searchTimeoutMs,
          onWarn: (message) => console.warn(message),
        })
      : null,
    prepareLens: prepareForLens,
    serpapi: new SerpApiSearcher({
      apiKey: config.serpapiKey,
      fetchImpl,
      cache: cache(),
      store: usageStore,
      monthlyLimit: maxSearches,
      timeoutMs: config.limits.searchTimeoutMs,
      onWarn: (message) => console.warn(message),
    }),
    rakuten: new RakutenSearcher({
      rakuten: config.rakuten,
      fetchImpl,
      cache: cache(),
      store: usageStore,
      timeoutMs: config.limits.searchTimeoutMs,
      hits: 10,
    }),
    maxSearchesPerProvider: config.limits.searchesPerProviderPerItem,
    pricing: config.pricing,
    serpapiCostPerSearchUsd: config.serpapiCostPerSearchUsd,
  });

  const rows: Record<string, unknown>[] = [];
  const details: unknown[] = [];
  const verdicts = { identified: 0, candidates: 0, unidentified: 0 };
  let identified = 0; // 識別を実行できたアイテム数
  let costSum = 0;
  let costCount = 0;
  let serpCalls = 0;
  let lensCalls = 0;
  let rakutenCalls = 0;
  let identifyIn = 0;
  let identifyOut = 0;
  let detectIn = 0;
  let detectOut = 0;

  for (const file of files) {
    const label = file.slice(0, 18);
    const data = readFileSync(join(dir, file));
    if (!validateImage(data).ok) {
      console.log(`${label}: JPEG/PNG ではないためスキップ`);
      continue;
    }

    let prepared;
    let items: DetectedItem[];
    try {
      prepared = await prepareForModel(data);
      const r = await detector.detect(prepared);
      items = r.items;
      detectIn += r.usage.inputTokens;
      detectOut += r.usage.outputTokens;
    } catch (e) {
      // 画像・キー・上流の詳細は出さず、種類だけ記録する。
      rows.push({ file: label, item: '-', error: `detect:${e instanceof Error ? e.name : 'unknown'}` });
      continue;
    }
    const photo = await sharp(prepared.data).metadata();

    for (const item of items) {
      const base = { file: label, item: item.id.slice(0, 12), category: item.categoryId };
      const failures: string[] = [];
      try {
        const rect = cropRect(item.box, { width: photo.width ?? 0, height: photo.height ?? 0 });
        const crop = await sharp(prepared.data).extract(rect).jpeg({ quality: 90 }).toBuffer();
        const image = await prepareForModel(crop);

        const claimed = item.brandCandidates[0]?.name ?? null;
        const brandRead =
          claimed !== null && item.appearance.visibleText.some((t) => containsWholeWords(claimed, t));

        const r: IdentifyResponse = await identifier.identify(image, item, {
          consent,
          onSearchFailure: (provider, detail) => failures.push(`${provider}:${detail}`),
        });
        identified += 1;
        verdicts[r.verdict] += 1;
        serpCalls += r.usage.serpapiSearches;
        lensCalls += r.usage.lensSearches;
        rakutenCalls += r.usage.rakutenCalls;
        identifyIn += r.usage.claude.inputTokens;
        identifyOut += r.usage.claude.outputTokens;
        if (r.estimatedCostUsd !== null) {
          costSum += r.estimatedCostUsd;
          costCount += 1;
        }
        rows.push({
          ...base,
          brandRead,
          verdict: r.verdict,
          candidates: r.candidates.length,
          top: clip(r.candidates[0]?.product.name ?? '-', 40),
          lens: r.searches.lens,
          serpapi: r.searches.serpapi,
          rakuten: r.searches.rakuten,
          searchFailures: failures.join(', ') || '-',
          comparison: r.comparison,
          usd: r.estimatedCostUsd?.toFixed(4) ?? '-',
        });
        details.push({
          file,
          item: item.id,
          category: item.categoryId,
          brandRead,
          verdict: r.verdict,
          level: r.level,
          searches: r.searches,
          searchFailures: failures,
          comparison: r.comparison,
          queries: r.queries,
          usage: r.usage,
          estimatedCostUsd: r.estimatedCostUsd,
          candidates: r.candidates.map((c) => ({
            name: c.product.name,
            brand: c.product.brand,
            seller: c.product.seller ?? null,
            source: c.product.source,
            price: c.product.price?.amount ?? null,
            matchScore: c.matchScore,
            matchType: c.matchType,
            matched: c.matched,
            unconfirmed: c.unconfirmed,
          })),
        });
      } catch (e) {
        rows.push({ ...base, error: e instanceof Error ? e.name : 'unknown', searchFailures: failures.join(', ') || '-' });
      }
    }
  }

  console.table(rows);
  console.log(`A(特定): ${verdicts.identified} / B(候補あり): ${verdicts.candidates} / C(特定できず): ${verdicts.unidentified}`);
  console.log(
    `1 アイテムあたりの平均原価: ${costCount > 0 ? `$${(costSum / costCount).toFixed(4)}(${costCount} 件)` : '- (PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK が未設定)'}`,
  );
  console.log(`SerpApi(Shopping)の合計: ${serpCalls} 回 / Lens(アップロード含む)の合計: ${lensCalls} 回 / 楽天の合計: ${rakutenCalls} 回`);
  console.log(
    `Claude の合計トークン: 特定 in ${identifyIn} / out ${identifyOut}、検出 in ${detectIn} / out ${detectOut}(合計 ${identifyIn + identifyOut + detectIn + detectOut})`,
  );
  const detectCost = estimateCostUsd({ inputTokens: detectIn, outputTokens: detectOut }, config.pricing);
  if (detectCost !== null) console.log(`(検出の概算費用 $${detectCost.toFixed(4)} は、上の平均原価に含まれません)`);

  const outDir = join(__dirname, '..', 'eval', 'results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    join(outDir, `identify-${stamp}.json`),
    JSON.stringify(
      {
        maxSearches,
        identifiedItems: identified,
        verdicts,
        averageCostUsd: costCount > 0 ? costSum / costCount : null,
        consent,
        serpapiCalls: serpCalls,
        lensCalls,
        rakutenCalls,
        tokens: { identify: { in: identifyIn, out: identifyOut }, detect: { in: detectIn, out: detectOut } },
        rows,
        details,
      },
      null,
      2,
    ),
  );
  console.log(`詳細: eval/results/identify-${stamp}.json`);
}

void main();
