import { z } from 'zod';

import type { Product } from '@coordinate/shared';

import type { TtlCache } from '../cache/ttl-cache';
import type { UsageStore } from '../usage/usage-store';
import { isAllowedImageUrl, isHttpsUrl } from './image-url';
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
  /** リクエスト送信の最小間隔(ms)。既定 1100(楽天は 1 秒に 1 リクエスト程度)。 */
  minIntervalMs?: number;
  /** 待機。テストで差し替える。 */
  sleep?: (ms: number) => Promise<void>;
  /** 間隔の計測に使う単調な時計(ms)。テストで差し替える。 */
  clockMs?: () => number;
};

const DEFAULT_MIN_INTERVAL_MS = 1100;

/** 楽天市場商品検索。キャッシュはメモリのみ・短時間(規約: 不特定多数が共有できる保存は禁止)。 */
export class RakutenSearcher implements ProductSearcher {
  /** 送信を直列にするための鎖。 */
  private chain: Promise<unknown> = Promise.resolve();
  private lastSentAt: number | null = null;

  constructor(private readonly deps: Deps) {}

  /** 前の送信から最小間隔が経つまで待ってから fn を実行する。同時に 1 件だけ実行する。 */
  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const gap = this.deps.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
      const clock = this.deps.clockMs ?? (() => performance.now());
      const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      if (this.lastSentAt !== null) {
        const wait = this.lastSentAt + gap - clock();
        if (wait > 0) await sleep(wait);
      }
      this.lastSentAt = clock();
      return fn();
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

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

    const sent = await this.throttled<{ fail: SearchOutcome } | { body: unknown }>(async () => {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.deps.timeoutMs);
      try {
        const res = await this.deps.fetchImpl(`${ENDPOINT}?${params}`, { signal: controller.signal });
        store.addMonthly(now, { rakuten: 1 });
        // 429 などは再試行しない(呼び出し側が次の検索語へ進むかを決める)。
        if (!res.ok) return { fail: { status: 'failed', products: [], calls: 1, detail: `http_${res.status}` } as SearchOutcome };
        return { body: (await res.json()) as unknown };
      } catch {
        return { fail: { status: 'failed', products: [], calls: 0, detail: timedOut ? 'timeout' : 'network' } as SearchOutcome };
      } finally {
        clearTimeout(timer);
      }
    });
    if ('fail' in sent) return sent.fail;
    const body = sent.body;

    const parsed = Response.safeParse(body);
    if (!parsed.success) return { status: 'failed', products: [], calls: 1, detail: 'parse' };

    const fetchedAt = now.toISOString();
    const products: Product[] = [];
    for (const raw of parsed.data.Items) {
      const r = ItemSchema.safeParse(raw);
      if (!r.success) continue;
      const it = r.data.Item;
      const image = it.mediumImageUrls?.[0]?.imageUrl;
      const pageUrl = [it.affiliateUrl, it.itemUrl].find((u): u is string => !!u && isHttpsUrl(u));
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
