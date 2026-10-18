import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Product } from '@coordinate/shared';

import type { TtlCache } from '../cache/ttl-cache';
import type { UsageStore } from '../usage/usage-store';
import { isAllowedLensThumbnailUrl, isHttpsUrl } from './image-url';
import type { SearchOutcome } from './types';

/** アップロード(multipart)も送れる fetch。 */
export type UploadFetchLike = (
  url: string,
  init?: { method?: string; body?: FormData; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * 実 API(2026-10-18 に確認)の visual_matches の 1 行。使うキーだけを検証する。
 * サムネイルは encrypted-tbn*.gstatic.com の thumbnail だけ(SerpApi のプロキシ版は無い)。
 * 価格は { value: '￥3,799*', extracted_value: 3799, currency: '￥' } で、$ など円以外もある。
 */
const Row = z.object({
  title: z.string().min(1),
  link: z.string().min(1),
  source: z.string().optional(),
  thumbnail: z.string().optional(),
  price: z.object({ extracted_value: z.number().nonnegative().optional(), currency: z.string().optional() }).optional(),
});
const Response = z.object({ visual_matches: z.array(z.unknown()).optional(), error: z.string().optional() });
const UploadResponse = z.object({ image_id: z.string().min(1) });

const WARN_RATIO = 0.8;
const YEN = new Set(['￥', '¥', 'JPY', '円']);
/** SerpApi が結果なしのときに 200 で返すメッセージ("Google Lens hasn't returned any results for this query.")。 */
const NO_RESULTS = /hasn't returned any results|no results/i;

type Deps = {
  apiKey: string | null;
  fetchImpl: UploadFetchLike;
  cache: TtlCache<Product[]>;
  store: UsageStore;
  monthlyLimit: number;
  timeoutMs: number;
  now?: () => Date;
  /** 月間上限の 80% に達したとき 1 度だけ呼ぶ。キーは渡さない。 */
  onWarn?: (message: string) => void;
};

type Step<T> = { ok: true; value: T } | { ok: false; detail: string };

/**
 * SerpApi の Image API(アップロード)+ Google Lens(visual_matches)。画像から、ウェブ上の類似画像のページを探す。
 * 結果は「商品」ではなくページなので、候補として返すだけで、正解扱いしない。
 * アップロードが検索回数に数えられるかは不明なため、安全側で 1 回と数える。
 */
export class LensSearcher {
  private warned = false;

  constructor(private readonly deps: Deps) {}

  async searchByImage(jpeg: Uint8Array): Promise<SearchOutcome> {
    const { apiKey, cache, store, monthlyLimit } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    if (!apiKey) return { status: 'not_configured', products: [], calls: 0 };

    const key = `lens:${createHash('sha256').update(jpeg).digest('hex')}`;
    const hit = cache.get(key);
    if (hit) return { status: 'ok', products: hit, calls: 0 };

    // アップロードと検索の 2 回分が残っていなければ始めない。1 回目の予約は await の前に行う。
    const used = store.monthly(now).serpapi;
    if (used + 2 > monthlyLimit) return { status: 'budget_exhausted', products: [], calls: 0 };
    store.addMonthly(now, { serpapi: 1 });
    this.warnIfNearLimit(used + 1);

    const form = new FormData();
    form.append('image', new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), 'item.jpg');
    form.append('api_key', apiKey);
    const upload = await this.request('https://serpapi.com/image', { method: 'POST', body: form }, 'upload_');
    if (!upload.ok) return { status: 'failed', products: [], calls: 1, detail: upload.detail };
    const id = UploadResponse.safeParse(upload.value);
    if (!id.success) return { status: 'failed', products: [], calls: 1, detail: 'upload_parse' };

    store.addMonthly(now, { serpapi: 1 });
    this.warnIfNearLimit(used + 2);
    const params = new URLSearchParams({
      engine: 'google_lens',
      image_id: id.data.image_id,
      type: 'visual_matches',
      country: 'jp',
      hl: 'ja',
      api_key: apiKey,
    });
    const search = await this.request(`https://serpapi.com/search.json?${params}`, {}, '');
    if (!search.ok) return { status: 'failed', products: [], calls: 2, detail: search.detail };
    const parsed = Response.safeParse(search.value);
    if (!parsed.success) return { status: 'failed', products: [], calls: 2, detail: 'parse' };
    if (parsed.data.visual_matches === undefined && parsed.data.error !== undefined && !NO_RESULTS.test(parsed.data.error)) {
      return { status: 'failed', products: [], calls: 2, detail: 'api_error' };
    }

    const fetchedAt = now.toISOString();
    const products: Product[] = [];
    for (const raw of parsed.data.visual_matches ?? []) {
      const r = Row.safeParse(raw);
      if (!r.success) continue;
      const row = r.data;
      const amount = row.price?.extracted_value;
      const isYen = row.price?.currency !== undefined && YEN.has(row.price.currency);
      products.push({
        source: 'google_lens',
        productId: row.link,
        brand: '',
        name: row.title,
        ...(row.thumbnail && isAllowedLensThumbnailUrl(row.thumbnail) ? { imageUrl: row.thumbnail } : {}),
        ...(isHttpsUrl(row.link) ? { pageUrl: row.link } : {}),
        ...(amount !== undefined && isYen ? { price: { amount, currency: 'JPY', kind: 'market' as const, fetchedAt } } : {}),
        ...(row.source ? { seller: row.source } : {}),
        fetchedAt,
      });
    }
    cache.set(key, products);
    return { status: 'ok', products, calls: 2 };
  }

  /** タイムアウトつきで 1 回だけ送る(再試行しない)。失敗の理由にキー・URL は含めない。 */
  private async request(
    url: string,
    init: { method?: string; body?: FormData },
    prefix: string,
  ): Promise<Step<unknown>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.deps.timeoutMs);
    try {
      const res = await this.deps.fetchImpl(url, { ...init, signal: controller.signal });
      if (!res.ok) return { ok: false, detail: `${prefix}http_${res.status}` };
      return { ok: true, value: await res.json() };
    } catch {
      return { ok: false, detail: `${prefix}${timedOut ? 'timeout' : 'network'}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private warnIfNearLimit(usedAfter: number): void {
    if (this.warned || !this.deps.onWarn) return;
    if (usedAfter >= this.deps.monthlyLimit * WARN_RATIO) {
      this.warned = true;
      this.deps.onWarn(`SerpApi の月間検索回数が上限の 80% に達しました(${usedAfter}/${this.deps.monthlyLimit})`);
    }
  }
}
