import { z } from 'zod';

import type { Product } from '@coordinate/shared';

import type { TtlCache } from '../cache/ttl-cache';
import type { UsageStore } from '../usage/usage-store';
import { isAllowedImageUrl } from './image-url';
import type { FetchLike, ProductSearcher, SearchOutcome } from './types';

const ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

const ItemSchema = z.object({
  Item: z.object({
    itemName: z.string().min(1),
    itemCode: z.string().min(1),
    itemPrice: z.number().nonnegative().optional(),
    itemUrl: z.string().url().optional(),
    /** affiliateId を渡したときに返る、アフィリエイト化された URL。 */
    affiliateUrl: z.string().optional(),
    shopName: z.string().optional(),
    mediumImageUrls: z.array(z.object({ imageUrl: z.string() })).optional(),
    availability: z.number().optional(),
  }),
});
const Response = z.object({ Items: z.array(z.unknown()) });

type Deps = {
  rakuten: { applicationId: string; accessKey: string; affiliateId: string | null } | null;
  fetchImpl: FetchLike;
  cache: TtlCache<Product[]>;
  store: UsageStore;
  timeoutMs: number;
  hits: number;
  now?: () => Date;
};

/** 楽天市場商品検索。キャッシュはメモリのみ・短時間(規約: 不特定多数が共有できる保存は禁止)。 */
export class RakutenSearcher implements ProductSearcher {
  constructor(private readonly deps: Deps) {}

  async search(query: string): Promise<SearchOutcome> {
    const { rakuten, cache, store } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    if (!rakuten) return { status: 'not_configured', products: [], calls: 0 };

    const key = `rakuten:${query}`;
    const hit = cache.get(key);
    if (hit) return { status: 'ok', products: hit, calls: 0 };

    const params = new URLSearchParams({
      applicationId: rakuten.applicationId,
      accessKey: rakuten.accessKey,
      keyword: query,
      hits: String(this.deps.hits),
      format: 'json',
    });
    if (rakuten.affiliateId) params.set('affiliateId', rakuten.affiliateId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);
    let body: unknown;
    try {
      const res = await this.deps.fetchImpl(`${ENDPOINT}?${params}`, { signal: controller.signal });
      store.addMonthly(now, { rakuten: 1 });
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
    for (const raw of parsed.data.Items) {
      const r = ItemSchema.safeParse(raw);
      if (!r.success) continue;
      const it = r.data.Item;
      const image = it.mediumImageUrls?.[0]?.imageUrl;
      const pageUrl = it.affiliateUrl || it.itemUrl;
      products.push({
        source: 'rakuten',
        productId: it.itemCode,
        brand: '',
        name: it.itemName,
        ...(image && isAllowedImageUrl(image) ? { imageUrl: image } : {}),
        ...(pageUrl ? { pageUrl } : {}),
        // 在庫がない商品の価格は、現在の販売価格として見せない。
        ...(it.itemPrice !== undefined && it.availability !== 0
          ? { price: { amount: it.itemPrice, currency: 'JPY', kind: 'market' as const, fetchedAt } }
          : {}),
        ...(it.shopName ? { seller: it.shopName } : {}),
        fetchedAt,
      });
    }
    cache.set(key, products);
    return { status: 'ok', products, calls: 1 };
  }
}
