import Anthropic from '@anthropic-ai/sdk';

import type { Product } from '@coordinate/shared';

import { buildApp } from './app';
import { TtlCache } from './cache/ttl-cache';
import { loadConfig } from './config';
import { ClaudeVisionDetector } from './detector/claude-vision-detector';
import { Comparer } from './identify/comparer';
import { fetchImage } from './search/fetch-image';
import { Identifier } from './identify/identifier';
import { QueryGenerator } from './identify/query-generator';
import { prepareForLens } from './image/prepare-lens';
import { LensSearcher } from './search/lens';
import { RakutenSearcher } from './search/rakuten';
import { SerpApiSearcher } from './search/serpapi';
import { FileUsageStore } from './usage/usage-store';

const config = loadConfig();
const anthropic = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey, timeout: 60_000, maxRetries: 1 })
  : null;
const detector = anthropic ? new ClaudeVisionDetector(anthropic, config.model, config.effort) : null;

const usageStore = new FileUsageStore(config.usageFile);
const cache = () => new TtlCache<Product[]>({ ttlMs: config.limits.cacheTtlMs, maxEntries: 500 });
const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => fetch(url, init);

// buildApp より先に作る警告の出力先。app 生成後に app.log へ流す。
let warn: (message: string) => void = (message) => console.warn(message);

// 画像を検索するのではなく、テキスト検索の結果を Claude が画像で照合する。Claude が使えなければ特定は行わない。
const identifier = anthropic
  ? new Identifier({
      queryGenerator: new QueryGenerator(anthropic, config.model, config.effort),
      comparer: new Comparer(anthropic, config.model, config.effort, (url) => fetchImage(url, { fetchImpl: fetch })),
      lens: config.lensEnabled
        ? new LensSearcher({
            apiKey: config.serpapiKey,
            fetchImpl: (url, init) => fetch(url, init),
            cache: cache(),
            store: usageStore,
            monthlyLimit: config.limits.serpapiMonthly,
            timeoutMs: config.limits.searchTimeoutMs,
            onWarn: (message) => warn(message),
          })
        : null,
      prepareLens: prepareForLens,
      serpapi: new SerpApiSearcher({
        apiKey: config.serpapiKey,
        fetchImpl,
        cache: cache(),
        store: usageStore,
        monthlyLimit: config.limits.serpapiMonthly,
        timeoutMs: config.limits.searchTimeoutMs,
        onWarn: (message) => warn(message),
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
    })
  : null;

const app = buildApp({ config, detector, identifier, usageStore, logger: true });
warn = (message) => app.log.warn(message);
if (!detector) app.log.warn('ANTHROPIC_API_KEY が未設定です。/v1/analyze と /v1/identify は 503 を返します。');
if (!config.serpapiKey) app.log.warn('SERPAPI_API_KEY が未設定です。Google Shopping の検索は使えません。');
if (!config.rakuten) app.log.warn('楽天のキーが未設定です。楽天の検索は使えません。');
else if (!config.rakuten.affiliateId) app.log.warn('RAKUTEN_AFFILIATE_ID が未設定です。楽天のリンクは収益化されません。');

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
