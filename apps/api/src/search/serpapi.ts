import { z } from 'zod';

import type { Product } from '@coordinate/shared';

import type { TtlCache } from '../cache/ttl-cache';
import type { UsageStore } from '../usage/usage-store';
import { isAllowedImageUrl } from './image-url';
import type { FetchLike, ProductSearcher, SearchOutcome } from './types';

const Row = z.object({
  title: z.string().min(1),
  product_id: z.union([z.string(), z.number()]).optional(),
  product_link: z.string().url().optional(),
  source: z.string().optional(),
  extracted_price: z.number().nonnegative().optional(),
  thumbnail: z.string().optional(),
});
const Response = z.object({ shopping_results: z.array(z.unknown()).optional() });

const WARN_RATIO = 0.8;

type Deps = {
  apiKey: string | null;
  fetchImpl: FetchLike;
  cache: TtlCache<Product[]>;
  store: UsageStore;
  monthlyLimit: number;
  timeoutMs: number;
  now?: () => Date;
  /** 月間上限の 80% に達したとき 1 度だけ呼ぶ。キーや検索語は渡さない。 */
  onWarn?: (message: string) => void;
};

/**
 * SerpApi の Google Shopping。結果は「Google ショッピング上の商品」で、product_link も Google の商品ページ。
 * 販売元は source に入る。ここでは正解扱いせず、候補として返すだけ。
 */
export class SerpApiSearcher implements ProductSearcher {
  private warned = false;

  constructor(private readonly deps: Deps) {}

  async search(query: string): Promise<SearchOutcome> {
    const { apiKey, cache, store, monthlyLimit } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    if (!apiKey) return { status: 'not_configured', products: [], calls: 0 };

    const key = `serpapi:${query}`;
    const hit = cache.get(key);
    if (hit) return { status: 'ok', products: hit, calls: 0 };

    const used = store.monthly(now).serpapi;
    if (used >= monthlyLimit) return { status: 'budget_exhausted', products: [], calls: 0 };

    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      gl: 'jp',
      hl: 'ja',
      json_restrictor: 'shopping_results',
      api_key: apiKey,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    let body: unknown;
    try {
      const res = await this.deps.fetchImpl(`https://serpapi.com/search.json?${params}`, { signal: controller.signal });
      // 送信した時点で 1 回と数える(失敗しても課金対象になりうるため安全側)。
      store.addMonthly(now, { serpapi: 1 });
      this.warnIfNearLimit(used + 1);
      if (!res.ok) return { status: 'failed', products: [], calls: 1 };
      body = await res.json();
    } catch {
      return { status: 'failed', products: [], calls: 0 };
    } finally {
      clearTimeout(timer);
    }

    const parsed = Response.safeParse(body);
    if (!parsed.success) return { status: 'failed', products: [], calls: 1 };

    const fetchedAt = now.toISOString();
    const products: Product[] = [];
    for (const raw of parsed.data.shopping_results ?? []) {
      const r = Row.safeParse(raw);
      if (!r.success) continue;
      const row = r.data;
      products.push({
        source: 'google_shopping',
        productId: String(row.product_id ?? row.product_link ?? row.title),
        brand: '',
        name: row.title,
        ...(row.thumbnail && isAllowedImageUrl(row.thumbnail) ? { imageUrl: row.thumbnail } : {}),
        ...(row.product_link ? { pageUrl: row.product_link } : {}),
        ...(row.extracted_price !== undefined
          ? { price: { amount: row.extracted_price, currency: 'JPY', kind: 'market' as const, fetchedAt } }
          : {}),
        ...(row.source ? { seller: row.source } : {}),
        fetchedAt,
      });
    }
    cache.set(key, products);
    return { status: 'ok', products, calls: 1 };
  }

  private warnIfNearLimit(usedAfter: number): void {
    if (this.warned || !this.deps.onWarn) return;
    if (usedAfter >= this.deps.monthlyLimit * WARN_RATIO) {
      this.warned = true;
      this.deps.onWarn(`SerpApi の月間検索回数が上限の 80% に達しました(${usedAfter}/${this.deps.monthlyLimit})`);
    }
  }
}
