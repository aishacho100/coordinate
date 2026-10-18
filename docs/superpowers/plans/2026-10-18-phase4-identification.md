# Phase 4 商品特定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 結果画面の各アイテムで「商品を探す」を押すと、SerpApi(Google Shopping)と楽天で候補を探し、Claude が切り抜き画像と照合して A(特定)・B(候補)・C(特定できず)を返す。

**Architecture:** `POST /v1/identify`(multipart: `image` + `item` JSON)。検索語の生成(Claude・テキストのみ)→ 2 つの検索を並行 → 候補を整理 → Claude が切り抜きと候補を照合 → 純関数の判定ルールで A・B・C を決める。キャッシュはメモリ、使用量はファイル(数値のみ)。クライアントは差し替え可能な小さなインターフェースにして、HTTP の境界を偽物に差し替えてテストする。

**Tech Stack:** Fastify 5 / zod 4 / `@anthropic-ai/sdk`(構造化出力)/ jest(api)/ Expo SDK 57 + jest-expo(mobile)。設計書: `docs/superpowers/specs/2026-10-18-phase4-identification-design.md`。

## 設計書との差分(実装前に把握すること)

1. **使用量の保存先は JSON ファイル**(設計書は SQLite)。`node:sqlite` は jest 29 で解決できない恐れがあり、`better-sqlite3` はネイティブ依存になるため。保存するのは数値の集計だけ。`UsageStore` インターフェースの裏に隠すので、後で SQLite に差し替えられる。
2. **検索語の生成はテキストだけ**(画像を再送しない)。画像の特徴は Phase 3 が抽出済みで、画像を送ると約 4,000 入力トークンが増えるため。画像は照合で使う。
3. **Google Shopping の `product_link` は Google ショッピングの商品ページ**で、販売店のページではない(実測)。`pageUrl` にはこれを入れ、画面では「Google ショッピングで見る(販売元: ○○)」と書く。
4. 手動追加したアイテム(`origin: 'manual'`)には「商品を探す」を出さない(検出時の特徴が無いため)。ユーザーが入力したブランドは検索にも A の根拠にも使わない。

## 実 API で確認済みの事実

- SerpApi `engine=google_shopping&gl=jp&hl=ja&q=...&json_restrictor=shopping_results`。結果は `shopping_results[]` で、`title`、`product_id`、`product_link`、`source`、`price`("￥16,500")、`extracted_price`(16500)、`thumbnail`(`https://encrypted-tbn0.gstatic.com/shopping?q=tbn:...`)。`link` は無い。
- 楽天 `GET https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=..&accessKey=..&affiliateId=..&keyword=..&hits=..&format=json`。**`accessKey` はクエリで渡す**(`Authorization: Bearer` は 400)。応答は `{ count, Items: [{ Item: { itemName, itemCode, itemPrice, itemUrl, shopName, mediumImageUrls: [{ imageUrl }], availability, ... } }] }`。`affiliateId` を付けると `itemUrl` がアフィリエイト URL になる。画像 URL は `https://thumbnail.image.rakuten.co.jp/...?_ex=128x128`。

## ファイル構成

```
packages/shared/src/identify.ts            (新規) 応答スキーマ
packages/shared/src/analyze.ts             (変更) エラーコード追加
apps/api/src/config.ts                     (変更) 検索まわりの設定
apps/api/src/cache/ttl-cache.ts            (新規) メモリキャッシュ
apps/api/src/usage/usage-store.ts          (新規) 使用量(JSON ファイル)
apps/api/src/search/types.ts               (新規) 検索の共通型
apps/api/src/search/serpapi.ts             (新規)
apps/api/src/search/rakuten.ts             (新規)
apps/api/src/search/image-url.ts           (新規) サムネイルの許可ドメイン
apps/api/src/identify/query-generator.ts   (新規) Claude: 検索語
apps/api/src/identify/comparer.ts          (新規) Claude: 照合
apps/api/src/identify/verdict.ts           (新規) 判定ルール(純関数)
apps/api/src/identify/identifier.ts        (新規) 全体の流れ
apps/api/src/routes/identify.ts            (新規)
apps/api/src/app.ts / server.ts            (変更)
apps/api/scripts/eval-identify.ts          (新規) 実 API の評価
apps/mobile/src/lib/{install-id,identify-api}.ts            (新規)
apps/mobile/src/features/analysis/{crop-item.ts,...}        (新規/変更)
apps/mobile/src/components/product-candidates.tsx           (新規)
apps/mobile/src/app/result.tsx                              (変更)
```

テストは api が `src/**/*.test.ts`(コード横)、mobile が `apps/mobile/__tests__/`。すべてのコミットメッセージは日本語、末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。

---

### Task 1: 共有スキーマとエラーコード

**Files:**
- Create: `packages/shared/src/identify.ts`, `packages/shared/src/identify.test.ts`
- Modify: `packages/shared/src/analyze.ts`(`ApiErrorCodeSchema`)、`packages/shared/src/index.ts`

- [ ] **Step 1: 失敗するテストを書く** — `packages/shared/src/identify.test.ts`

```ts
import { ApiErrorCodeSchema } from './analyze';
import { IdentifyResponseSchema, verdictToLevel } from './identify';

const product = {
  source: 'google_shopping',
  productId: 'p1',
  brand: '',
  name: 'NIKE Air Force 1',
  pageUrl: 'https://www.google.com/search?ibp=oshop&q=x',
  imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:a',
  price: { amount: 16500, currency: 'JPY', kind: 'market', fetchedAt: '2026-10-18T00:00:00.000Z' },
  fetchedAt: '2026-10-18T00:00:00.000Z',
};

const base = {
  itemId: 'item_1',
  verdict: 'candidates',
  level: 'low',
  rationale: '候補は見つかりましたが、同じ商品とは確認できませんでした',
  candidates: [{ product, matchScore: 0.6, matchType: 'similar', matched: ['色'], unconfirmed: ['型番'] }],
  searches: { serpapi: 'ok', rakuten: 'not_configured' },
  comparison: 'done',
  queries: ['nike air force 1 白'],
  usage: { claude: { inputTokens: 100, outputTokens: 50 }, serpapiSearches: 1, rakutenCalls: 0 },
  estimatedCostUsd: null,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  timings: { total: 1200 },
};

describe('IdentifyResponseSchema', () => {
  it('正しい応答を受け付ける', () => {
    expect(IdentifyResponseSchema.safeParse(base).success).toBe(true);
  });
  it('候補は最大 5 件', () => {
    const c = base.candidates[0]!;
    expect(IdentifyResponseSchema.safeParse({ ...base, candidates: Array(6).fill(c) }).success).toBe(false);
  });
  it('未知の判定は拒否する', () => {
    expect(IdentifyResponseSchema.safeParse({ ...base, verdict: 'sure' }).success).toBe(false);
  });
});

describe('verdictToLevel', () => {
  it('A は high、B はブランド採用済みなら medium、なければ low、C は unidentified', () => {
    expect(verdictToLevel('identified', false)).toBe('high');
    expect(verdictToLevel('candidates', true)).toBe('medium');
    expect(verdictToLevel('candidates', false)).toBe('low');
    expect(verdictToLevel('unidentified', true)).toBe('unidentified');
  });
});

describe('ApiErrorCodeSchema', () => {
  it('商品特定で使うコードを含む', () => {
    for (const c of ['search_unavailable', 'identify_failed', 'quota_exceeded', 'invalid_request']) {
      expect(ApiErrorCodeSchema.safeParse(c).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w @coordinate/shared` — Expected: FAIL(`./identify` が無い)

- [ ] **Step 3: 実装** — `packages/shared/src/identify.ts`

```ts
import { z } from 'zod';

import { UsageSchema } from './analyze';
import { IdentificationLevelSchema, ProductCandidateSchema, type IdentificationLevel } from './item';

/** A: 特定 / B: 候補あり / C: 特定できず。 */
export const IdentifyVerdictSchema = z.enum(['identified', 'candidates', 'unidentified']);
export type IdentifyVerdict = z.infer<typeof IdentifyVerdictSchema>;

export const SearchStatusSchema = z.enum(['ok', 'not_configured', 'budget_exhausted', 'failed']);
export type SearchStatus = z.infer<typeof SearchStatusSchema>;

/** 候補と、何が一致し何が確認できていないか。 */
export const IdentifyCandidateSchema = ProductCandidateSchema.extend({
  matched: z.array(z.string()),
  unconfirmed: z.array(z.string()),
});
export type IdentifyCandidate = z.infer<typeof IdentifyCandidateSchema>;

export const IdentifyResponseSchema = z.object({
  itemId: z.string().min(1),
  verdict: IdentifyVerdictSchema,
  level: IdentificationLevelSchema,
  rationale: z.string(),
  candidates: z.array(IdentifyCandidateSchema).max(5),
  searches: z.object({ serpapi: SearchStatusSchema, rakuten: SearchStatusSchema }),
  /** 画像との照合の結果。failed のときは候補を「未照合」として返す。 */
  comparison: z.enum(['done', 'failed', 'skipped']),
  queries: z.array(z.string()),
  usage: z.object({
    claude: UsageSchema,
    serpapiSearches: z.number().int().nonnegative(),
    rakutenCalls: z.number().int().nonnegative(),
  }),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  fetchedAt: z.string().datetime(),
  timings: z.object({ total: z.number().nonnegative() }),
});
export type IdentifyResponse = z.infer<typeof IdentifyResponseSchema>;

/** 判定から表示段階への対応。Phase 3 でブランドを採用済みの B は medium。 */
export function verdictToLevel(verdict: IdentifyVerdict, brandRead: boolean): IdentificationLevel {
  if (verdict === 'identified') return 'high';
  if (verdict === 'candidates') return brandRead ? 'medium' : 'low';
  return 'unidentified';
}
```

`packages/shared/src/analyze.ts` の `ApiErrorCodeSchema` を次に置き換える:

```ts
export const ApiErrorCodeSchema = z.enum([
  'invalid_image',
  'too_large',
  'analysis_failed',
  'not_configured',
  'rate_limited',
  'invalid_request',
  'quota_exceeded',
  'search_unavailable',
  'identify_failed',
]);
```

`packages/shared/src/index.ts` に `export * from './identify';` を追加する。

`packages/shared/src/item.ts` の `ProductSchema` に、販売元を入れる `seller: z.string().optional(),` を `pageUrl` の次の行に追加する(Task 5・6 で使う)。`identify.test.ts` の `product` にも `seller: 'Nike Japan'` を足す。

- [ ] **Step 4: 通過と型検査を確認** — Run: `npm test -w @coordinate/shared && npm run typecheck -w @coordinate/shared` — Expected: PASS。
  注意: `Record<ApiErrorCode, string>` を使う `apps/api/src/routes/analyze.ts` の `MESSAGES` と `apps/mobile/src/lib/analyze-api.ts` の `ERROR_MESSAGES` は、この時点で型エラーになる。Task 10 と Task 11 で直す。それまでの api / mobile のコミットは typecheck を通すため、この Task では下の暫定対応も入れる:
  - `routes/analyze.ts` の `MESSAGES` に追加(Task 10 で文言を最終化):
    `invalid_request: 'リクエストの内容が正しくありません。'`、`quota_exceeded: '本日の利用上限に達しました。'`、`search_unavailable: '商品検索が利用できません。'`、`identify_failed: '商品の特定に失敗しました。'`
  - `analyze-api.ts` の `ERROR_MESSAGES` に同じ 4 キーを追加(利用者向けの文言)。

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/api/src/routes/analyze.ts apps/mobile/src/lib/analyze-api.ts
git commit -m "feat(shared): 商品特定の応答スキーマとエラーコードを追加"
```

---

### Task 2: 設定(キー・上限・価格)

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`

- [ ] **Step 1: テストを足す** — `config.test.ts` の末尾に追加(既存の `loadConfig({})` スタイルに合わせる)

```ts
describe('loadConfig: 商品検索', () => {
  it('未設定なら検索は使えず、上限は既定値', () => {
    const c = loadConfig({});
    expect(c.serpapiKey).toBeNull();
    expect(c.rakuten).toBeNull();
    expect(c.limits).toEqual({
      searchesPerProviderPerItem: 2,
      cacheTtlMs: 3_600_000,
      identifyPerInstallPerDay: 30,
      identifyPerIpPerDay: 90,
      serpapiMonthly: 200,
      searchTimeoutMs: 15_000,
    });
    expect(c.serpapiCostPerSearchUsd).toBeNull();
    expect(c.usageFile).toBe('data/usage.json');
  });
  it('楽天は applicationId と accessKey がそろったときだけ有効(affiliateId は任意)', () => {
    expect(loadConfig({ RAKUTEN_APPLICATION_ID: 'a' }).rakuten).toBeNull();
    expect(loadConfig({ RAKUTEN_APPLICATION_ID: 'a', RAKUTEN_ACCESS_KEY: 'k' }).rakuten).toEqual({
      applicationId: 'a',
      accessKey: 'k',
      affiliateId: null,
    });
    expect(
      loadConfig({ RAKUTEN_APPLICATION_ID: 'a', RAKUTEN_ACCESS_KEY: 'k', RAKUTEN_AFFILIATE_ID: 'x' }).rakuten
        ?.affiliateId,
    ).toBe('x');
  });
  it('数値の設定を読む。不正な値は既定値に戻す', () => {
    const c = loadConfig({
      SERPAPI_API_KEY: 's',
      SERPAPI_MONTHLY_LIMIT: '100',
      SEARCH_CACHE_TTL_SECONDS: '60',
      SERPAPI_COST_PER_SEARCH_USD: '0.025',
      IDENTIFY_DAILY_LIMIT: 'abc',
    });
    expect(c.serpapiKey).toBe('s');
    expect(c.limits.serpapiMonthly).toBe(100);
    expect(c.limits.cacheTtlMs).toBe(60_000);
    expect(c.serpapiCostPerSearchUsd).toBe(0.025);
    expect(c.limits.identifyPerInstallPerDay).toBe(30);
    expect(c.limits.identifyPerIpPerDay).toBe(90);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- config` — Expected: FAIL

- [ ] **Step 3: 実装** — `config.ts` の `Config` 型に追加:

```ts
  serpapiKey: string | null;
  /** applicationId と accessKey がそろったときだけ非 null。affiliateId が無ければ収益化されない。 */
  rakuten: { applicationId: string; accessKey: string; affiliateId: string | null } | null;
  limits: {
    /** 1 アイテムの特定で、1 つの検索元に投げる検索の最大回数。 */
    searchesPerProviderPerItem: number;
    cacheTtlMs: number;
    identifyPerInstallPerDay: number;
    identifyPerIpPerDay: number;
    serpapiMonthly: number;
    searchTimeoutMs: number;
  };
  /** SerpApi 1 検索あたりの概算 USD(プランの月額 ÷ 検索数)。未設定なら費用に含めない。 */
  serpapiCostPerSearchUsd: number | null;
  /** 使用量(数値のみ)の保存先 JSON ファイル。 */
  usageFile: string;
```

`loadConfig` の戻り値に追加(`positiveNumber` を使う。文字列は `trim()` 後に空なら null):

```ts
  const nonEmpty = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const rakutenId = nonEmpty(env.RAKUTEN_APPLICATION_ID);
  const rakutenKey = nonEmpty(env.RAKUTEN_ACCESS_KEY);
  const perInstall = positiveNumber(env.IDENTIFY_DAILY_LIMIT) ?? 30;
  // ...return { ...既存, 
  serpapiKey: nonEmpty(env.SERPAPI_API_KEY),
  rakuten:
    rakutenId && rakutenKey
      ? { applicationId: rakutenId, accessKey: rakutenKey, affiliateId: nonEmpty(env.RAKUTEN_AFFILIATE_ID) }
      : null,
  limits: {
    searchesPerProviderPerItem: 2,
    cacheTtlMs: (positiveNumber(env.SEARCH_CACHE_TTL_SECONDS) ?? 3600) * 1000,
    identifyPerInstallPerDay: perInstall,
    identifyPerIpPerDay: perInstall * 3,
    serpapiMonthly: positiveNumber(env.SERPAPI_MONTHLY_LIMIT) ?? 200,
    searchTimeoutMs: 15_000,
  },
  serpapiCostPerSearchUsd: positiveNumber(env.SERPAPI_COST_PER_SEARCH_USD),
  usageFile: nonEmpty(env.USAGE_FILE) ?? 'data/usage.json',
```

`apps/api/.gitignore` が無ければ作らず、リポジトリ直下 `.gitignore` に `apps/api/data/` を追加する。

- [ ] **Step 4: 通過と型検査** — Run: `npm test -w api -- config && npm run typecheck -w api` — Expected: PASS(`buildApp` を呼ぶ既存テストは `loadConfig({})` を使うので影響なし)

- [ ] **Step 5: Commit** — `feat(api): 商品検索の設定(キー・上限・価格)を追加`

---

### Task 3: メモリキャッシュ

**Files:** Create `apps/api/src/cache/ttl-cache.ts`, `apps/api/src/cache/ttl-cache.test.ts`

- [ ] **Step 1: テスト**

```ts
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('期限内は同じ値を返し、期限を過ぎたら消える', () => {
    let now = 0;
    const c = new TtlCache<number>({ ttlMs: 1000, maxEntries: 10, now: () => now });
    c.set('a', 1);
    now = 999;
    expect(c.get('a')).toBe(1);
    now = 1000;
    expect(c.get('a')).toBeUndefined();
  });
  it('上限を超えたら古いものから捨てる', () => {
    const c = new TtlCache<number>({ ttlMs: 1000, maxEntries: 2, now: () => 0 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- ttl-cache` — Expected: FAIL

- [ ] **Step 3: 実装**

```ts
type Options = { ttlMs: number; maxEntries: number; now?: () => number };

/** メモリだけのキャッシュ。ファイル・DB には保存しない(楽天の規約の範囲に収める)。 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly opts: Options) {
    this.now = opts.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() >= e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.opts.ttlMs });
    while (this.map.size > this.opts.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
```

- [ ] **Step 4: 通過を確認** — Run: `npm test -w api -- ttl-cache` — Expected: PASS
- [ ] **Step 5: Commit** — `feat(api): 検索結果用のメモリキャッシュを追加`

---

### Task 4: 使用量の記録と上限

**Files:** Create `apps/api/src/usage/usage-store.ts`, `apps/api/src/usage/usage-store.test.ts`

インターフェースと JSON ファイル実装を作る。`path` が null ならメモリだけ(テストと評価用)。識別子(インストール ID・IP)はハッシュにして保存する。

- [ ] **Step 1: テスト**

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileUsageStore, monthKey, dayKey } from './usage-store';

const d = (s: string) => new Date(s);

describe('UsageStore', () => {
  it('月ごとの検索回数とトークン数を積算する', () => {
    const s = new FileUsageStore(null);
    s.addMonthly(d('2026-10-18T00:00:00Z'), { serpapi: 2, rakuten: 1, claudeInput: 100, claudeOutput: 40 });
    s.addMonthly(d('2026-10-30T00:00:00Z'), { serpapi: 1 });
    expect(s.monthly(d('2026-10-31T00:00:00Z'))).toEqual({ serpapi: 3, rakuten: 1, claudeInput: 100, claudeOutput: 40 });
    expect(s.monthly(d('2026-11-01T00:00:00Z')).serpapi).toBe(0);
  });

  it('1 日あたりの回数を数え、上限を判定する(識別子はハッシュで保存)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-'));
    const file = join(dir, 'u.json');
    try {
      const s = new FileUsageStore(file);
      const now = d('2026-10-18T03:00:00Z');
      expect(s.tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(true);
      expect(s.tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(true);
      expect(s.tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(false);
      expect(s.tryConsumeDaily(now, 'install', 'other', 2)).toBe(true);
      const raw = readFileSync(file, 'utf8');
      expect(raw).not.toContain('abc-install-id');
      // 再読み込みしても残る
      expect(new FileUsageStore(file).tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('前日より古い日次カウンタを捨てる', () => {
    const s = new FileUsageStore(null);
    s.tryConsumeDaily(d('2026-10-10T00:00:00Z'), 'ip', '1.2.3.4', 5);
    s.tryConsumeDaily(d('2026-10-18T00:00:00Z'), 'ip', '1.2.3.4', 5);
    expect(s.dailyKeyCount()).toBe(1);
  });

  it('月・日のキー', () => {
    expect(monthKey(d('2026-10-18T00:00:00Z'))).toBe('2026-10');
    expect(dayKey(d('2026-10-18T00:00:00Z'))).toBe('2026-10-18');
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- usage-store` — Expected: FAIL

- [ ] **Step 3: 実装** — `usage-store.ts`

```ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type MonthlyUsage = { serpapi: number; rakuten: number; claudeInput: number; claudeOutput: number };
export type DailyKind = 'install' | 'ip';

export interface UsageStore {
  monthly(now: Date): MonthlyUsage;
  addMonthly(now: Date, delta: Partial<MonthlyUsage>): void;
  /** 上限内なら 1 回ぶん消費して true。上限に達していれば消費せず false。 */
  tryConsumeDaily(now: Date, kind: DailyKind, id: string, limit: number): boolean;
}

type FileShape = { months: Record<string, MonthlyUsage>; days: Record<string, Record<string, number>> };

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const hash = (kind: string, id: string) => createHash('sha256').update(`${kind}:${id}`).digest('hex').slice(0, 16);
const empty = (): MonthlyUsage => ({ serpapi: 0, rakuten: 0, claudeInput: 0, claudeOutput: 0 });

/** 数値の集計だけを保存する。写真・検索結果・生の識別子は入れない。path が null ならメモリのみ。 */
export class FileUsageStore implements UsageStore {
  private data: FileShape = { months: {}, days: {} };

  constructor(private readonly path: string | null) {
    if (path && existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FileShape>;
        this.data = { months: parsed.months ?? {}, days: parsed.days ?? {} };
      } catch {
        // 壊れていたら空から始める(集計が消えるだけで、動作は続ける)
      }
    }
  }

  monthly(now: Date): MonthlyUsage {
    return { ...empty(), ...this.data.months[monthKey(now)] };
  }

  addMonthly(now: Date, delta: Partial<MonthlyUsage>): void {
    const cur = this.monthly(now);
    this.data.months[monthKey(now)] = {
      serpapi: cur.serpapi + (delta.serpapi ?? 0),
      rakuten: cur.rakuten + (delta.rakuten ?? 0),
      claudeInput: cur.claudeInput + (delta.claudeInput ?? 0),
      claudeOutput: cur.claudeOutput + (delta.claudeOutput ?? 0),
    };
    this.save();
  }

  tryConsumeDaily(now: Date, kind: DailyKind, id: string, limit: number): boolean {
    const today = dayKey(now);
    for (const k of Object.keys(this.data.days)) if (k < today) delete this.data.days[k];
    const day = (this.data.days[today] ??= {});
    const key = hash(kind, id);
    const used = day[key] ?? 0;
    if (used >= limit) return false;
    day[key] = used + 1;
    this.save();
    return true;
  }

  /** テスト用: 保持している日次カウンタの数。 */
  dailyKeyCount(): number {
    return Object.values(this.data.days).reduce((n, day) => n + Object.keys(day).length, 0);
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
}
```

- [ ] **Step 4: 通過を確認** — Run: `npm test -w api -- usage-store` — Expected: PASS
- [ ] **Step 5: Commit** — `feat(api): 使用量の記録と日次・月次の上限を追加`

---

### Task 5: 検索の共通型と SerpApi(Google Shopping)

**Files:** Create `apps/api/src/search/types.ts`, `apps/api/src/search/image-url.ts`, `apps/api/src/search/serpapi.ts`, `apps/api/src/search/serpapi.test.ts`, `apps/api/src/search/image-url.test.ts`

- [ ] **Step 1: 型** — `search/types.ts`

```ts
import type { Product, SearchStatus } from '@coordinate/shared';

export type SearchOutcome = {
  status: SearchStatus;
  products: Product[];
  /** 実際に外部へ送った回数(キャッシュの命中は含めない)。 */
  calls: number;
};

export interface ProductSearcher {
  /** 設定が無い・上限到達・失敗は例外ではなく status で返す。 */
  search(query: string): Promise<SearchOutcome>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
```

- [ ] **Step 2: サムネイルの許可ドメイン(テストから)** — `image-url.test.ts`

```ts
import { isAllowedImageUrl } from './image-url';

describe('isAllowedImageUrl', () => {
  it('Google のサムネイルと楽天の画像だけを許可する', () => {
    expect(isAllowedImageUrl('https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc')).toBe(true);
    expect(isAllowedImageUrl('https://thumbnail.image.rakuten.co.jp/@0_mall/a/b.jpg?_ex=128x128')).toBe(true);
  });
  it('http・他のドメイン・内部アドレス・不正な URL は拒否する', () => {
    expect(isAllowedImageUrl('http://encrypted-tbn0.gstatic.com/x')).toBe(false);
    expect(isAllowedImageUrl('https://evil.example.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://gstatic.com.evil.example/x')).toBe(false);
    expect(isAllowedImageUrl('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedImageUrl('not a url')).toBe(false);
  });
});
```

`image-url.ts`:

```ts
const HOSTS = [/^encrypted-tbn\d\.gstatic\.com$/, /^thumbnail\.image\.rakuten\.co\.jp$/];

/** 候補の画像 URL を Claude に渡してよいか。https かつ許可ドメインのみ。 */
export function isAllowedImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && HOSTS.some((re) => re.test(u.hostname));
}
```

- [ ] **Step 3: SerpApi のテスト** — `serpapi.test.ts`

```ts
import { TtlCache } from '../cache/ttl-cache';
import { FileUsageStore } from '../usage/usage-store';
import { SerpApiSearcher } from './serpapi';
import type { FetchLike } from './types';

const NOW = new Date('2026-10-18T03:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  title: 'NIKE Air FORCE 1 07 Men',
  product_id: '123',
  product_link: 'https://www.google.com/search?ibp=oshop&q=x&prds=catalogid:1',
  source: 'Nike Japan',
  price: '￥16,500',
  extracted_price: 16500,
  thumbnail: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc',
  ...over,
});
const okFetch = (rows: unknown[]): FetchLike & { urls: string[] } => {
  const f = (async (url: string) => {
    f.urls.push(url);
    return { ok: true, status: 200, json: async () => ({ shopping_results: rows }) };
  }) as FetchLike & { urls: string[] };
  f.urls = [];
  return f;
};
const make = (fetchImpl: FetchLike, over: { key?: string | null; limit?: number } = {}) => {
  const store = new FileUsageStore(null);
  const cache = new TtlCache<never>({ ttlMs: 1000, maxEntries: 10, now: () => 0 }) as unknown as TtlCache<any>;
  const s = new SerpApiSearcher({
    apiKey: over.key === undefined ? 'KEY' : over.key,
    fetchImpl,
    cache,
    store,
    monthlyLimit: over.limit ?? 200,
    timeoutMs: 1000,
    now: () => NOW,
  });
  return { s, store };
};

describe('SerpApiSearcher', () => {
  it('Google Shopping を日本向けで呼び、Product に整える', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f);
    const r = await s.search('nike air force 1 白');
    expect(r.status).toBe('ok');
    expect(r.calls).toBe(1);
    expect(f.urls[0]).toContain('engine=google_shopping');
    expect(f.urls[0]).toContain('gl=jp');
    expect(f.urls[0]).toContain('hl=ja');
    expect(f.urls[0]).toContain('json_restrictor=shopping_results');
    expect(r.products[0]).toMatchObject({
      source: 'google_shopping',
      productId: '123',
      name: 'NIKE Air FORCE 1 07 Men',
      brand: '',
      pageUrl: expect.stringContaining('google.com/search'),
      imageUrl: expect.stringContaining('gstatic.com'),
      price: { amount: 16500, currency: 'JPY', kind: 'market' },
    });
    expect(r.products[0]?.price?.fetchedAt).toBe(NOW.toISOString());
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('価格が取れない行は price を空にする(推測しない)', async () => {
    const { s } = make(okFetch([row({ price: undefined, extracted_price: undefined })]));
    expect((await s.search('q')).products[0]?.price).toBeUndefined();
  });

  it('同じ検索語はキャッシュから返し、外部へ送らない', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f);
    await s.search('q');
    const second = await s.search('q');
    expect(second.calls).toBe(0);
    expect(second.status).toBe('ok');
    expect(f.urls).toHaveLength(1);
    expect(store.monthly(NOW).serpapi).toBe(1);
  });

  it('キー未設定なら not_configured で、外部へ送らない', async () => {
    const f = okFetch([]);
    const r = await make(f, { key: null }).s.search('q');
    expect(r).toEqual({ status: 'not_configured', products: [], calls: 0 });
    expect(f.urls).toHaveLength(0);
  });

  it('月間上限に達していたら budget_exhausted', async () => {
    const f = okFetch([row()]);
    const { s, store } = make(f, { limit: 1 });
    store.addMonthly(NOW, { serpapi: 1 });
    expect((await s.search('q')).status).toBe('budget_exhausted');
    expect(f.urls).toHaveLength(0);
  });

  it('HTTP エラー・通信失敗・不正な応答は failed。再試行しない', async () => {
    const bad: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const boom: FetchLike = async () => {
      throw new Error('network');
    };
    const junk: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ shopping_results: 5 }) });
    for (const f of [bad, boom, junk]) {
      const r = await make(f).s.search('q');
      expect(r.status).toBe('failed');
      expect(r.products).toEqual([]);
    }
  });

  it('結果が 0 件(shopping_results が無い応答)でも、失敗ではなく「結果なし」の ok として扱う', async () => {
    const f: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ error: 'Google hasn\'t returned any results' }) });
    const r = await make(f).s.search('q');
    expect(r.status).toBe('ok');
    expect(r.products).toEqual([]);
  });
});
```

注: 最後のテストの意図は、結果が 0 件のとき(SerpApi は 0 件を `error` で返す)でも、失敗ではなく「結果なし」として扱うこと。実装では `shopping_results` が無い応答を 0 件の `ok` にする。ただし `shopping_results` が配列でなければ `failed`。

- [ ] **Step 4: 失敗を確認** — Run: `npm test -w api -- serpapi image-url` — Expected: FAIL

- [ ] **Step 5: 実装** — `serpapi.ts`

```ts
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

type Deps = {
  apiKey: string | null;
  fetchImpl: FetchLike;
  cache: TtlCache<Product[]>;
  store: UsageStore;
  monthlyLimit: number;
  timeoutMs: number;
  now?: () => Date;
};

/**
 * SerpApi の Google Shopping。結果は「Google ショッピング上の商品」で、product_link も Google の商品ページ。
 * 販売元は source に入る。ここでは正解扱いせず、候補として返すだけ。
 */
export class SerpApiSearcher implements ProductSearcher {
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
      } as Product);
    }
    cache.set(key, products);
    return { status: 'ok', products, calls: 1 };
  }
}
```

実装時の注意: `Product` に `seller`(販売元)は無い。**`ProductSchema`(packages/shared/src/item.ts)に `seller: z.string().optional()` を追加する**(Task 1 の一部として行い、`identify.test.ts` の `product` に `seller: 'Nike Japan'` を足してもよい)。上の `as Product` の型断言は、`seller` を追加したら外す。

- [ ] **Step 6: 通過と型検査** — Run: `npm test -w api -- serpapi image-url && npm run typecheck -w api` — Expected: PASS
- [ ] **Step 7: Commit** — `feat(api): SerpApi(Google Shopping)の検索クライアントを追加`

---

### Task 6: 楽天市場商品検索

**Files:** Create `apps/api/src/search/rakuten.ts`, `apps/api/src/search/rakuten.test.ts`

- [ ] **Step 1: テスト** — SerpApi のテストと同じ構造。違う点だけを明記する

```ts
import { TtlCache } from '../cache/ttl-cache';
import { FileUsageStore } from '../usage/usage-store';
import { RakutenSearcher } from './rakuten';
import type { FetchLike } from './types';

const NOW = new Date('2026-10-18T03:00:00Z');
const item = (over: Record<string, unknown> = {}) => ({
  Item: {
    itemName: 'ナイキ エアフォース1 メンズ スニーカー ホワイト',
    itemCode: 'alpen:10526255',
    itemPrice: 7590,
    itemUrl: 'https://hb.afl.rakuten.co.jp/ichiba/x/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Falpen%2F1%2F',
    shopName: 'アルペン楽天市場店',
    mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/alpen/a.jpg?_ex=128x128' }],
    availability: 1,
    ...over,
  },
});
const okFetch = (items: unknown[]): FetchLike & { urls: string[] } => {
  const f = (async (url: string) => {
    f.urls.push(url);
    return { ok: true, status: 200, json: async () => ({ count: items.length, Items: items }) };
  }) as FetchLike & { urls: string[] };
  f.urls = [];
  return f;
};
const make = (fetchImpl: FetchLike, rakuten: { applicationId: string; accessKey: string; affiliateId: string | null } | null = { applicationId: 'APP', accessKey: 'AK', affiliateId: 'AF' }) =>
  new RakutenSearcher({
    rakuten,
    fetchImpl,
    cache: new TtlCache<any>({ ttlMs: 1000, maxEntries: 10, now: () => 0 }),
    store: new FileUsageStore(null),
    timeoutMs: 1000,
    hits: 10,
    now: () => NOW,
  });

describe('RakutenSearcher', () => {
  it('新しいエンドポイントを accessKey をクエリで付けて呼び、Product に整える', async () => {
    const f = okFetch([item()]);
    const r = await make(f).search('ナイキ エアフォース1');
    expect(f.urls[0]).toContain('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?');
    expect(f.urls[0]).toContain('applicationId=APP');
    expect(f.urls[0]).toContain('accessKey=AK');
    expect(f.urls[0]).toContain('affiliateId=AF');
    expect(f.urls[0]).toContain('hits=10');
    expect(r.status).toBe('ok');
    expect(r.products[0]).toMatchObject({
      source: 'rakuten',
      productId: 'alpen:10526255',
      seller: 'アルペン楽天市場店',
      price: { amount: 7590, currency: 'JPY', kind: 'market' },
    });
    expect(r.products[0]?.imageUrl).toContain('thumbnail.image.rakuten.co.jp');
  });
  it('affiliateId が無ければクエリに付けない', async () => {
    const f = okFetch([]);
    await make(f, { applicationId: 'APP', accessKey: 'AK', affiliateId: null }).search('q');
    expect(f.urls[0]).not.toContain('affiliateId');
  });
  it('在庫なし(availability 0)の商品は価格を出さない', async () => {
    const r = await make(okFetch([item({ availability: 0 })])).search('q');
    expect(r.products[0]?.price).toBeUndefined();
  });
  it('未設定・失敗・不正な応答・キャッシュ', async () => {
    expect((await make(okFetch([]), null).search('q')).status).toBe('not_configured');
    const f400: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ errors: {} }) });
    expect((await make(f400).search('q')).status).toBe('failed');
    const junk: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ Items: 'x' }) });
    expect((await make(junk).search('q')).status).toBe('failed');
    const f = okFetch([item()]);
    const s = make(f);
    await s.search('same');
    expect((await s.search('same')).calls).toBe(0);
    expect(f.urls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- rakuten` — Expected: FAIL
- [ ] **Step 3: 実装** — `rakuten.ts`

```ts
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
      products.push({
        source: 'rakuten',
        productId: it.itemCode,
        brand: '',
        name: it.itemName,
        ...(image && isAllowedImageUrl(image) ? { imageUrl: image } : {}),
        ...(it.itemUrl ? { pageUrl: it.itemUrl } : {}),
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
```

- [ ] **Step 4: 通過と型検査** — Run: `npm test -w api -- rakuten && npm run typecheck -w api` — Expected: PASS
- [ ] **Step 5: Commit** — `feat(api): 楽天市場商品検索のクライアントを追加`

---

### Task 7: 検索語の生成(Claude・テキストのみ)

**Files:** Create `apps/api/src/identify/query-generator.ts`, `apps/api/src/identify/query-generator.test.ts`

`MessagesClient`(`claude-vision-detector.ts` からエクスポート済み)を使う。出力は構造化出力。

- [ ] **Step 1: テスト**

```ts
import type { MessagesClient } from '../detector/claude-vision-detector';
import { sampleItem } from '../test-utils';
import { QueryGenerator } from './query-generator';

const reply = (text: string, over: Record<string, unknown> = {}) =>
  ({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    model: 'm',
    usage: { input_tokens: 80, output_tokens: 20 },
    ...over,
  }) as never;
const client = (r: unknown): MessagesClient & { calls: any[] } => {
  const c = {
    calls: [] as any[],
    messages: {
      create: async (p: unknown) => {
        c.calls.push(p);
        return r as never;
      },
    },
  };
  return c;
};

describe('QueryGenerator', () => {
  it('特徴から検索語を作り、トークン数を返す。画像は送らない', async () => {
    const c = client(reply(JSON.stringify({ queries: ['白 Tシャツ メンズ', '白 無地 Tシャツ'] })));
    const g = new QueryGenerator(c, 'm', 'low');
    const r = await g.generate({ ...sampleItem, appearance: { colors: ['白'], visibleText: ['NIKE'] }, brandCandidates: [{ name: 'Nike', score: 0.9 }] });
    expect(r.queries).toEqual(['白 Tシャツ メンズ', '白 無地 Tシャツ']);
    expect(r.usage).toEqual({ inputTokens: 80, outputTokens: 20 });
    const sent = JSON.stringify(c.calls[0]);
    expect(sent).not.toContain('"type":"image"');
    expect(sent).toContain('Nike');
  });
  it('空・重複・長すぎる検索語を除き、最大 3 個にする', async () => {
    const long = 'あ'.repeat(200);
    const c = client(reply(JSON.stringify({ queries: ['a', 'a', ' ', long, 'b', 'c', 'd'] })));
    const r = await new QueryGenerator(c, 'm', 'low').generate(sampleItem);
    expect(r.queries).toEqual(['a', 'b', 'c']);
  });
  it('検索語が 1 つも得られなければ GenerationError', async () => {
    const c = client(reply(JSON.stringify({ queries: [] })));
    await expect(new QueryGenerator(c, 'm', 'low').generate(sampleItem)).rejects.toThrow('QueryGenerationError');
  });
  it('JSON でない・拒否・打ち切りは GenerationError', async () => {
    for (const r of [reply('nope'), reply('{}', { stop_reason: 'refusal' }), reply('{}', { stop_reason: 'max_tokens' })]) {
      await expect(new QueryGenerator(client(r), 'm', 'low').generate(sampleItem)).rejects.toThrow('QueryGenerationError');
    }
  });
});
```

注: `rejects.toThrow('QueryGenerationError')` は、エラーの `name` ではなく `message` 照合なので、`message` に `'QueryGenerationError'` を含める(下の実装で `super('QueryGenerationError: ...')`)。

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- query-generator` — Expected: FAIL
- [ ] **Step 3: 実装**

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { DEFAULT_CATEGORIES, type DetectedItem, type Usage } from '@coordinate/shared';

import type { Effort } from '../config';
import type { MessagesClient } from '../detector/claude-vision-detector';

export class QueryGenerationError extends Error {
  constructor(detail: string) {
    super(`QueryGenerationError: ${detail}`);
    this.name = 'QueryGenerationError';
  }
}

const Output = z.object({ queries: z.array(z.string()) });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queries'],
  properties: { queries: { type: 'array', items: { type: 'string' } } },
} as const;

const SYSTEM = `You write web shopping search queries (in Japanese, optionally with English brand words) for one clothing or accessory item that was observed in a photo.

Rules:
- Return 1 to 3 queries, from the most specific to the most general.
- Use only the facts given. Include a brand only if the "brand" field is present. Never guess a brand, model name, or model number.
- Include the item type, the main color, and any legible text or distinctive design words that were given.
- Each query is at most 8 words. No quotes, no operators.`;

const categoryName = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.labelJa ?? id;

export class QueryGenerator {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    private readonly effort: Effort,
  ) {}

  async generate(item: DetectedItem): Promise<{ queries: string[]; usage: Usage }> {
    const facts = {
      category: categoryName(item.categoryId),
      colors: item.appearance.colors,
      pattern: item.appearance.pattern ?? null,
      material: item.appearance.material ?? null,
      legible_text: item.appearance.visibleText,
      brand: item.brandCandidates[0]?.name ?? null,
      notes: item.appearance.notes ?? null,
    };
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: SYSTEM,
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(facts) }] }],
    });
    if (res.stop_reason === 'refusal') throw new QueryGenerationError('refusal');
    if (res.stop_reason === 'max_tokens') throw new QueryGenerationError('truncated');
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    let json: unknown;
    try {
      json = JSON.parse(text ?? '');
    } catch {
      throw new QueryGenerationError('not json');
    }
    const parsed = Output.safeParse(json);
    if (!parsed.success) throw new QueryGenerationError('schema');

    const seen = new Set<string>();
    const queries: string[] = [];
    for (const q of parsed.data.queries) {
      const t = q.trim();
      if (t === '' || t.length > 80 || seen.has(t)) continue;
      seen.add(t);
      queries.push(t);
      if (queries.length === 3) break;
    }
    if (queries.length === 0) throw new QueryGenerationError('empty');
    return { queries, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  }
}
```

- [ ] **Step 4: 通過と型検査** — Run: `npm test -w api -- query-generator && npm run typecheck -w api` — Expected: PASS
- [ ] **Step 5: Commit** — `feat(api): Claude による検索語の生成を追加`

---

### Task 8: 照合(Claude・画像)と判定ルール

**Files:** Create `apps/api/src/identify/comparer.ts`, `comparer.test.ts`, `verdict.ts`, `verdict.test.ts`。さらに `normalize.ts` から語の一致関数を共有する。

- [ ] **Step 1: 語の一致を共有する** — `apps/api/src/detector/normalize.ts` の `words` と、語としての一致判定を **エクスポート**する(挙動を変えない)。`findEvidence` の判定行を関数に切り出す:

```ts
export function containsWholeWords(brand: string, text: string): boolean {
  const b = words(brand);
  const bCompact = b.replace(/ /g, '');
  if (bCompact.length < 2) return false;
  const w = words(text);
  if (w === '') return false;
  return ` ${w} `.includes(` ${b} `) || w.replace(/ /g, '') === bCompact;
}
```

`findEvidence` は `containsWholeWords(brand, t)` を使うように書き換え、`normalize.test.ts` が変わらず通ることを確認する。

- [ ] **Step 2: 判定ルールのテスト** — `verdict.test.ts`

```ts
import type { Product } from '@coordinate/shared';

import { decideVerdict, type Judgement } from './verdict';

const product = (name: string, extra: Partial<Product> = {}): Product => ({
  source: 'rakuten',
  productId: name,
  brand: '',
  name,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  ...extra,
});
const j = (over: Partial<Judgement> = {}): Judgement => ({
  index: 0,
  sameProduct: false,
  nameMatchesFeatures: false,
  similarity: 0,
  matched: [],
  unconfirmed: [],
  ...over,
});
const withImage = { imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' };

describe('decideVerdict', () => {
  const brandRead = 'Nike';
  const cands = [product('ナイキ エアフォース1 NIKE', withImage), product('adidas スーパースター', withImage)];

  it('A: 写真でブランドを読み取り、候補名に同じブランドがあり、画像も特徴も一致する', () => {
    const r = decideVerdict({
      brandRead,
      candidates: cands,
      judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.9, matched: ['ロゴ'] })],
    });
    expect(r.verdict).toBe('identified');
    expect(r.candidates[0]?.matchType).toBe('identical');
  });

  it('写真でブランドを読み取れていなければ A にしない(B に落とす)', () => {
    const r = decideVerdict({
      brandRead: null,
      candidates: cands,
      judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.95 })],
    });
    expect(r.verdict).toBe('candidates');
    expect(r.candidates[0]?.matchType).toBe('similar');
  });

  it('候補名に写真のブランドが無ければ A にしない', () => {
    const r = decideVerdict({
      brandRead,
      candidates: [product('無名ブランド スニーカー', withImage)],
      judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.95 })],
    });
    expect(r.verdict).toBe('candidates');
  });

  it('名前や特徴が合わない・画像が無い候補は A にしない', () => {
    const noImage = [product('ナイキ NIKE エアフォース1')];
    expect(
      decideVerdict({ brandRead, candidates: cands, judgements: [j({ sameProduct: true, nameMatchesFeatures: false, similarity: 0.9 })] }).verdict,
    ).toBe('candidates');
    expect(
      decideVerdict({ brandRead, candidates: noImage, judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.9 })] }).verdict,
    ).toBe('candidates');
  });

  it('B: 似ている候補を類似度の高い順に最大 5 件。低い候補は含めない', () => {
    const many = Array.from({ length: 8 }, (_, i) => product(`p${i}`, withImage));
    const js = many.map((_, i) => j({ index: i, similarity: i / 10 }));
    const r = decideVerdict({ brandRead: null, candidates: many, judgements: js });
    expect(r.verdict).toBe('candidates');
    expect(r.candidates).toHaveLength(5);
    expect(r.candidates[0]?.matchScore).toBeGreaterThanOrEqual(r.candidates[4]!.matchScore);
    expect(r.candidates.every((c) => c.matchScore >= 0.4)).toBe(true);
  });

  it('C: 似ている候補が無い、または候補が無い', () => {
    expect(decideVerdict({ brandRead: null, candidates: [], judgements: [] }).verdict).toBe('unidentified');
    const r = decideVerdict({ brandRead: null, candidates: cands, judgements: [j({ similarity: 0.1 })] });
    expect(r.verdict).toBe('unidentified');
    expect(r.candidates).toEqual([]);
  });

  it('範囲外・重複の index は無視する', () => {
    const r = decideVerdict({
      brandRead: null,
      candidates: cands,
      judgements: [j({ index: 9, similarity: 0.9 }), j({ index: 0, similarity: 0.5 }), j({ index: 0, similarity: 0.99 })],
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.matchScore).toBe(0.5);
  });
});
```

- [ ] **Step 3: 失敗を確認** — Run: `npm test -w api -- verdict` — Expected: FAIL
- [ ] **Step 4: 判定ルールの実装** — `verdict.ts`

```ts
import type { IdentifyCandidate, IdentifyVerdict, Product } from '@coordinate/shared';

import { containsWholeWords } from '../detector/normalize';

/** Claude の照合結果 1 件(候補の index と対応)。 */
export type Judgement = {
  index: number;
  sameProduct: boolean;
  nameMatchesFeatures: boolean;
  similarity: number;
  matched: string[];
  unconfirmed: string[];
};

/** B に含める最低の類似度。Claude の自己申告であり、確率ではない。 */
export const MIN_SIMILARITY = 0.4;
export const MAX_CANDIDATES = 5;

/**
 * A・B・C を決める。A は「写真の文字からブランドを読み取れている」「候補名に同じブランドが語として現れる」
 * 「候補に画像がある」「画像が同一商品と判断された」「名前や型番が読み取れた文字・特徴と合う」を全部満たすときだけ。
 */
export function decideVerdict(input: {
  brandRead: string | null;
  candidates: Product[];
  judgements: Judgement[];
}): { verdict: IdentifyVerdict; candidates: IdentifyCandidate[] } {
  const seen = new Set<number>();
  const valid: Array<{ product: Product; judgement: Judgement }> = [];
  for (const jd of input.judgements) {
    const product = input.candidates[jd.index];
    if (!product || seen.has(jd.index)) continue;
    seen.add(jd.index);
    valid.push({ product, judgement: { ...jd, similarity: Math.min(Math.max(jd.similarity, 0), 1) } });
  }
  valid.sort((a, b) => b.judgement.similarity - a.judgement.similarity);

  const isIdentical = ({ product, judgement }: (typeof valid)[number]) =>
    input.brandRead !== null &&
    containsWholeWords(input.brandRead, `${product.brand} ${product.name}`) &&
    product.imageUrl !== undefined &&
    judgement.sameProduct &&
    judgement.nameMatchesFeatures;

  const toCandidate = (e: (typeof valid)[number], identical: boolean): IdentifyCandidate => ({
    product: e.product,
    matchScore: e.judgement.similarity,
    matchType: identical ? 'identical' : 'similar',
    matched: e.judgement.matched,
    unconfirmed: e.judgement.unconfirmed,
  });

  const best = valid.find(isIdentical);
  if (best) {
    const rest = valid.filter((e) => e !== best && e.judgement.similarity >= MIN_SIMILARITY);
    return {
      verdict: 'identified',
      candidates: [toCandidate(best, true), ...rest.map((e) => toCandidate(e, false))].slice(0, MAX_CANDIDATES),
    };
  }

  const similar = valid.filter((e) => e.judgement.similarity >= MIN_SIMILARITY).slice(0, MAX_CANDIDATES);
  if (similar.length === 0) return { verdict: 'unidentified', candidates: [] };
  return { verdict: 'candidates', candidates: similar.map((e) => toCandidate(e, false)) };
}
```

- [ ] **Step 5: 通過を確認** — Run: `npm test -w api -- verdict normalize` — Expected: PASS

- [ ] **Step 6: 照合クライアントのテスト** — `comparer.test.ts`

```ts
import type { MessagesClient } from '../detector/claude-vision-detector';
import type { Product } from '@coordinate/shared';

import { Comparer } from './comparer';

const p = (name: string, imageUrl?: string): Product => ({
  source: 'rakuten',
  productId: name,
  brand: '',
  name,
  ...(imageUrl ? { imageUrl } : {}),
  fetchedAt: '2026-10-18T00:00:00.000Z',
});
const reply = (obj: unknown, over: Record<string, unknown> = {}) =>
  ({ content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn', model: 'm', usage: { input_tokens: 900, output_tokens: 120 }, ...over }) as never;
const client = (r: unknown) => {
  const c = {
    calls: [] as any[],
    messages: {
      create: async (x: unknown) => {
        c.calls.push(x);
        return r as never;
      },
    },
  };
  return c as MessagesClient & { calls: any[] };
};
const img = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' as const };
const row = (index: number, over: Record<string, unknown> = {}) => ({
  index,
  same_product: false,
  name_matches_features: false,
  similarity: 0.5,
  matched: ['色'],
  unconfirmed: ['型番'],
  ...over,
});

describe('Comparer', () => {
  it('切り抜きと候補の画像 URL を渡し、判断を返す', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true, similarity: 0.9 })] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('a', 'https://thumbnail.image.rakuten.co.jp/a.jpg')]);
    expect(out.judgements[0]).toMatchObject({ index: 0, sameProduct: true, nameMatchesFeatures: true, similarity: 0.9 });
    expect(out.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
    const content = c.calls[0].messages[0].content;
    expect(content.filter((b: any) => b.type === 'image')).toHaveLength(2);
    expect(content.some((b: any) => b.type === 'image' && b.source.type === 'url' && b.source.url.includes('rakuten'))).toBe(true);
  });
  it('画像が無い候補は同一とは判断させない(sameProduct を false に固定)', async () => {
    const c = client(reply({ results: [row(0, { same_product: true, name_matches_features: true })] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('no-image')]);
    expect(out.judgements[0]?.sameProduct).toBe(false);
    expect(c.calls[0].messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(1);
  });
  it('範囲外の index と不正な値を捨てる', async () => {
    const c = client(reply({ results: [row(5), row(0, { similarity: 7 }), row(0)] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, [p('a')]);
    expect(out.judgements).toHaveLength(1);
  });
  it('拒否・打ち切り・JSON でない出力は ComparisonError', async () => {
    for (const r of [reply({}, { stop_reason: 'refusal' }), reply({}, { stop_reason: 'max_tokens' }), { content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }]) {
      await expect(new Comparer(client(r), 'm', 'low').compare(img, [p('a')])).rejects.toThrow('ComparisonError');
    }
  });
  it('候補が無ければ Claude を呼ばない', async () => {
    const c = client(reply({ results: [] }));
    const out = await new Comparer(c, 'm', 'low').compare(img, []);
    expect(out.judgements).toEqual([]);
    expect(c.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 7: 失敗を確認** — Run: `npm test -w api -- comparer` — Expected: FAIL
- [ ] **Step 8: 照合クライアントの実装** — `comparer.ts`

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { DetectorImage, Product, Usage } from '@coordinate/shared';

import type { Effort } from '../config';
import type { MessagesClient } from '../detector/claude-vision-detector';
import { isAllowedImageUrl } from '../search/image-url';
import type { Judgement } from './verdict';

export class ComparisonError extends Error {
  constructor(detail: string) {
    super(`ComparisonError: ${detail}`);
    this.name = 'ComparisonError';
  }
}

const Row = z.object({
  index: z.number().int(),
  same_product: z.boolean(),
  name_matches_features: z.boolean(),
  similarity: z.number(),
  matched: z.array(z.string()),
  unconfirmed: z.array(z.string()),
});
const Output = z.object({ results: z.array(Row) });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'same_product', 'name_matches_features', 'similarity', 'matched', 'unconfirmed'],
        properties: {
          index: { type: 'integer' },
          same_product: { type: 'boolean' },
          name_matches_features: { type: 'boolean' },
          similarity: { type: 'number' },
          matched: { type: 'array', items: { type: 'string' } },
          unconfirmed: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

const SYSTEM = `You compare ONE item cropped from an outfit photo (the first image) with candidate products found by a web search.

For each candidate (identified by its index) return:
- same_product: true ONLY if the candidate image shows the very same product (same design, color, and distinctive details), not just a similar-looking one. If the candidate has no image, it must be false.
- name_matches_features: true only if the candidate's name or model number agrees with text that is legible on the item or with the item's distinctive features.
- similarity: 0 to 1, how visually and descriptively close the candidate is to the item. It is a rough measure, not a probability.
- matched: short Japanese phrases for what matches (for example 色, 形, ロゴ).
- unconfirmed: short Japanese phrases for what could not be confirmed (for example 型番, 素材, サイズ).
Be strict. A product page existing is not evidence of identity. Return one result per candidate.`;

type Params = { dataUrl?: never };

export class Comparer {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    private readonly effort: Effort,
  ) {}

  async compare(image: DetectorImage, candidates: Product[]): Promise<{ judgements: Judgement[]; usage: Usage }> {
    if (candidates.length === 0) return { judgements: [], usage: { inputTokens: 0, outputTokens: 0 } };

    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: 'Item cropped from the photo:' },
      {
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: Buffer.from(image.data).toString('base64') },
      },
    ];
    candidates.forEach((c, i) => {
      const lines = [`Candidate ${i}: ${c.name}`, c.seller ? `seller: ${c.seller}` : '', c.price ? `price: ${c.price.amount} ${c.price.currency}` : ''];
      content.push({ type: 'text', text: lines.filter(Boolean).join('\n') });
      if (c.imageUrl && isAllowedImageUrl(c.imageUrl)) {
        content.push({ type: 'image', source: { type: 'url', url: c.imageUrl } });
      } else {
        content.push({ type: 'text', text: '(no image for this candidate)' });
      }
    });

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw new ComparisonError('refusal');
    if (res.stop_reason === 'max_tokens') throw new ComparisonError('truncated');
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    let json: unknown;
    try {
      json = JSON.parse(text ?? '');
    } catch {
      throw new ComparisonError('not json');
    }
    const parsed = Output.safeParse(json);
    if (!parsed.success) throw new ComparisonError('schema');

    const seen = new Set<number>();
    const judgements: Judgement[] = [];
    for (const r of parsed.data.results) {
      const cand = candidates[r.index];
      if (!cand || seen.has(r.index)) continue;
      if (!Number.isFinite(r.similarity) || r.similarity < 0 || r.similarity > 1) continue;
      seen.add(r.index);
      judgements.push({
        index: r.index,
        // 画像が無い候補は、同一商品とは判断できない。
        sameProduct: cand.imageUrl ? r.same_product : false,
        nameMatchesFeatures: r.name_matches_features,
        similarity: r.similarity,
        matched: r.matched.slice(0, 5),
        unconfirmed: r.unconfirmed.slice(0, 5),
      });
    }
    return { judgements, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  }
}
```

(上のコードの未使用の `type Params` 行は書かない。)

- [ ] **Step 9: 通過と型検査** — Run: `npm test -w api -- comparer verdict && npm run typecheck -w api` — Expected: PASS。`source: { type: 'url', url }` が SDK の型に無ければ、`node_modules/@anthropic-ai/sdk` の型で URL 画像の正しい形を確認して合わせる(型エラーになるはず)。
- [ ] **Step 10: Commit** — `feat(api): 切り抜きと候補の照合、A・B・C の判定ルールを追加`

---

### Task 9: 特定の流れ(Identifier)

**Files:** Create `apps/api/src/identify/identifier.ts`, `identifier.test.ts`

依存は全部インターフェース(`QueryGenerator`/`Comparer`/`ProductSearcher`)で受け、偽物に差し替えてテストする。

- [ ] **Step 1: テスト**

```ts
import type { DetectedItem, Product } from '@coordinate/shared';

import { sampleItem } from '../test-utils';
import type { ProductSearcher, SearchOutcome } from '../search/types';
import { Identifier } from './identifier';

const NOW = new Date('2026-10-18T03:00:00Z');
const product = (name: string, source = 'rakuten', imageUrl = 'https://thumbnail.image.rakuten.co.jp/a.jpg'): Product => ({
  source,
  productId: `${source}:${name}`,
  brand: '',
  name,
  imageUrl,
  fetchedAt: NOW.toISOString(),
});
const searcher = (outcomes: SearchOutcome[]): ProductSearcher & { queries: string[] } => {
  const s = {
    queries: [] as string[],
    async search(q: string) {
      s.queries.push(q);
      return outcomes[Math.min(s.queries.length - 1, outcomes.length - 1)]!;
    },
  };
  return s;
};
const ok = (products: Product[], calls = 1): SearchOutcome => ({ status: 'ok', products, calls });
const img = { data: new Uint8Array([1]), mediaType: 'image/jpeg' as const };
const usage = (i: number, o: number) => ({ inputTokens: i, outputTokens: o });

const make = (over: Partial<ConstructorParameters<typeof Identifier>[0]> = {}) =>
  new Identifier({
    queryGenerator: { generate: async () => ({ queries: ['q1', 'q2'], usage: usage(80, 20) }) },
    comparer: {
      compare: async (_i, cands) => ({
        judgements: cands.map((_, index) => ({ index, sameProduct: false, nameMatchesFeatures: false, similarity: 0.6, matched: ['色'], unconfirmed: ['型番'] })),
        usage: usage(900, 100),
      }),
    },
    serpapi: searcher([ok([product('g1', 'google_shopping')])]),
    rakuten: searcher([ok([product('r1')])]),
    maxSearchesPerProvider: 2,
    pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    serpapiCostPerSearchUsd: 0.025,
    now: () => NOW,
    ...over,
  });

describe('Identifier', () => {
  it('両方で検索して照合し、B を返す。使用量と概算費用を集計する', async () => {
    const r = await make().identify(img, sampleItem);
    expect(r.verdict).toBe('candidates');
    expect(r.level).toBe('low');
    expect(r.candidates.length).toBe(2);
    expect(r.searches).toEqual({ serpapi: 'ok', rakuten: 'ok' });
    expect(r.comparison).toBe('done');
    expect(r.usage).toEqual({ claude: usage(980, 120), serpapiSearches: 1, rakutenCalls: 1 });
    expect(r.estimatedCostUsd).toBeCloseTo((980 * 2 + 120 * 10) / 1e6 + 0.025, 6);
    expect(r.fetchedAt).toBe(NOW.toISOString());
  });

  it('候補が少なければ 2 つ目の検索語で追加検索する(最大 2 回まで)', async () => {
    const serp = searcher([ok([]), ok([product('g2', 'google_shopping')])]);
    const rak = searcher([ok([])]);
    await make({ serpapi: serp, rakuten: rak }).identify(img, sampleItem);
    expect(serp.queries).toEqual(['q1', 'q2']);
    expect(rak.queries).toEqual(['q1', 'q2']);
  });

  it('十分な候補があれば追加検索しない', async () => {
    const many = Array.from({ length: 5 }, (_, i) => product(`g${i}`, 'google_shopping'));
    const serp = searcher([ok(many)]);
    const rak = searcher([ok(many.map((p) => ({ ...p, source: 'rakuten', productId: `r-${p.productId}` })))]);
    await make({ serpapi: serp, rakuten: rak }).identify(img, sampleItem);
    expect(serp.queries).toEqual(['q1']);
  });

  it('片方が使えなくても、もう一方の結果で続け、状態を返す', async () => {
    const r = await make({ serpapi: searcher([{ status: 'budget_exhausted', products: [], calls: 0 }]) }).identify(img, sampleItem);
    expect(r.searches).toEqual({ serpapi: 'budget_exhausted', rakuten: 'ok' });
    expect(r.candidates.length).toBe(1);
  });

  it('両方使えなければ SearchUnavailableError', async () => {
    const dead = searcher([{ status: 'not_configured', products: [], calls: 0 }]);
    await expect(make({ serpapi: dead, rakuten: dead }).identify(img, sampleItem)).rejects.toThrow('SearchUnavailableError');
  });

  it('候補が 0 件なら C。照合の Claude は呼ばない', async () => {
    let called = false;
    const r = await make({
      serpapi: searcher([ok([])]),
      rakuten: searcher([ok([])]),
      comparer: { compare: async () => ((called = true), { judgements: [], usage: usage(0, 0) }) },
    }).identify(img, sampleItem);
    expect(r.verdict).toBe('unidentified');
    expect(r.level).toBe('unidentified');
    expect(called).toBe(false);
  });

  it('照合が失敗したら、候補を「未照合」として B で返す(A にはしない)', async () => {
    const brandItem: DetectedItem = { ...sampleItem, brandCandidates: [{ name: 'Nike', score: 0.9 }] };
    const r = await make({
      comparer: {
        compare: async () => {
          throw new Error('x');
        },
      },
    }).identify(img, brandItem);
    expect(r.comparison).toBe('failed');
    expect(r.verdict).toBe('candidates');
    expect(r.candidates[0]?.unconfirmed).toContain('画像との照合ができませんでした');
    expect(r.candidates[0]?.matchType).toBe('similar');
  });

  it('検索語の生成が失敗したら例外(検索は一度も行わない)', async () => {
    const serp = searcher([ok([])]);
    await expect(
      make({
        serpapi: serp,
        queryGenerator: {
          generate: async () => {
            throw new Error('x');
          },
        },
      }).identify(img, sampleItem),
    ).rejects.toThrow();
    expect(serp.queries).toHaveLength(0);
  });

  it('同じ商品(同じ source と productId)は 1 件にまとめる', async () => {
    const dup = product('same');
    const r = await make({ serpapi: searcher([ok([])]), rakuten: searcher([ok([dup, dup])]) }).identify(img, sampleItem);
    expect(r.candidates).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- identifier` — Expected: FAIL
- [ ] **Step 3: 実装** — `identifier.ts`

```ts
import {
  verdictToLevel,
  type DetectedItem,
  type DetectorImage,
  type IdentifyCandidate,
  type IdentifyResponse,
  type Product,
  type SearchStatus,
  type Usage,
} from '@coordinate/shared';

import type { Config } from '../config';
import type { ProductSearcher } from '../search/types';
import { estimateCostUsd } from '../usage';
import type { Comparer } from './comparer';
import type { QueryGenerator } from './query-generator';
import { decideVerdict, MAX_CANDIDATES } from './verdict';

export class SearchUnavailableError extends Error {
  constructor() {
    super('SearchUnavailableError: 検索が使えません');
    this.name = 'SearchUnavailableError';
  }
}

/** 追加検索を行わなくてよい、1 つの検索元あたりの候補数。 */
const ENOUGH = 3;
/** 照合に渡す候補の最大数(検索元ごとに半分ずつ)。 */
const COMPARE_LIMIT = 8;

type Deps = {
  queryGenerator: Pick<QueryGenerator, 'generate'>;
  comparer: Pick<Comparer, 'compare'>;
  serpapi: ProductSearcher;
  rakuten: ProductSearcher;
  maxSearchesPerProvider: number;
  pricing: Config['pricing'];
  serpapiCostPerSearchUsd: number | null;
  now?: () => Date;
};

type Collected = { products: Product[]; status: SearchStatus; calls: number };

export class Identifier {
  constructor(private readonly deps: Deps) {}

  async identify(image: DetectorImage, item: DetectedItem): Promise<IdentifyResponse> {
    const t0 = performance.now();
    const now = (this.deps.now ?? (() => new Date()))();
    const gen = await this.deps.queryGenerator.generate(item);

    const [serp, rak] = await Promise.all([
      this.collect(this.deps.serpapi, gen.queries),
      this.collect(this.deps.rakuten, gen.queries),
    ]);
    const usable = (s: SearchStatus) => s === 'ok';
    if (!usable(serp.status) && !usable(rak.status)) throw new SearchUnavailableError();

    // 検索元ごとに半分ずつ取り、重複(同じ source と productId)を除く。
    const half = COMPARE_LIMIT / 2;
    const seen = new Set<string>();
    const merged: Product[] = [];
    for (const p of [...serp.products.slice(0, half), ...rak.products.slice(0, half)]) {
      const k = `${p.source}:${p.productId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(p);
    }

    const brandRead = item.brandCandidates[0]?.name ?? null;
    let claude: Usage = gen.usage;
    let comparison: IdentifyResponse['comparison'] = 'skipped';
    let verdict: IdentifyResponse['verdict'];
    let candidates: IdentifyCandidate[];

    if (merged.length === 0) {
      ({ verdict, candidates } = decideVerdict({ brandRead, candidates: [], judgements: [] }));
    } else {
      try {
        const cmp = await this.deps.comparer.compare(image, merged);
        claude = add(claude, cmp.usage);
        comparison = 'done';
        ({ verdict, candidates } = decideVerdict({ brandRead, candidates: merged, judgements: cmp.judgements }));
      } catch {
        // 照合できなかった場合は、確定させず、候補を「未照合」として返す。
        comparison = 'failed';
        verdict = 'candidates';
        candidates = merged.slice(0, MAX_CANDIDATES).map((product) => ({
          product,
          matchScore: 0,
          matchType: 'similar' as const,
          matched: [],
          unconfirmed: ['画像との照合ができませんでした'],
        }));
      }
    }

    const level = verdictToLevel(verdict, brandRead !== null);
    const serpapiSearches = serp.calls;
    const rakutenCalls = rak.calls;
    const claudeCost = estimateCostUsd(claude, this.deps.pricing);
    const serpCost =
      this.deps.serpapiCostPerSearchUsd === null ? 0 : serpapiSearches * this.deps.serpapiCostPerSearchUsd;

    return {
      itemId: item.id,
      verdict,
      level,
      rationale: rationale(verdict, comparison),
      candidates,
      searches: { serpapi: serp.status, rakuten: rak.status },
      comparison,
      queries: gen.queries,
      usage: { claude, serpapiSearches, rakutenCalls },
      estimatedCostUsd: claudeCost === null ? null : claudeCost + serpCost,
      fetchedAt: now.toISOString(),
      timings: { total: Math.round(performance.now() - t0) },
    };
  }

  /** 1 つ目の検索語で検索し、候補が少なければ 2 つ目で 1 回だけ追加検索する。 */
  private async collect(searcher: ProductSearcher, queries: string[]): Promise<Collected> {
    const out: Collected = { products: [], status: 'failed', calls: 0 };
    const max = Math.min(this.deps.maxSearchesPerProvider, queries.length);
    for (let i = 0; i < max; i++) {
      const r = await searcher.search(queries[i]!);
      out.calls += r.calls;
      out.status = r.status;
      if (r.status !== 'ok') break;
      out.products.push(...r.products);
      if (out.products.length >= ENOUGH) break;
    }
    return out;
  }
}

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

function rationale(verdict: IdentifyResponse['verdict'], comparison: IdentifyResponse['comparison']): string {
  if (verdict === 'identified') return '写真の文字・商品名・画像が一致する商品を確認できました';
  if (verdict === 'candidates') {
    return comparison === 'failed'
      ? '候補は見つかりましたが、画像との照合ができなかったため、確定できません'
      : '似た商品は見つかりましたが、同じ商品とは確認できませんでした';
  }
  return '手がかりが足りず、商品を特定できませんでした';
}
```

注: 2 つ目の検索語で `status` が上書きされるため、1 つ目が `ok` で 2 つ目が `failed` なら全体が `failed` に見える。**1 つ目の結果が `ok` なら、2 つ目の失敗では `status` を `ok` のままにする**(`if (r.status !== 'ok') { if (out.products.length === 0 && i === 0) out.status = r.status; break; }` の形に直す。テスト「片方が使えなくても…」と「両方使えなければ…」が通ることで確認)。

- [ ] **Step 4: 通過と型検査** — Run: `npm test -w api -- identifier && npm run typecheck -w api` — Expected: PASS
- [ ] **Step 5: Commit** — `feat(api): 商品特定の流れ(検索語→検索→照合→判定)を追加`

---

### Task 10: ルートと配線

**Files:** Create `apps/api/src/routes/identify.ts`, `apps/api/src/routes/identify.test.ts`; Modify `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/analyze.ts`(MESSAGES を最終化)

- [ ] **Step 1: テスト** — `identify.test.ts`(`fakeIdentifier` を使う)

```ts
import { IdentifyResponseSchema, type IdentifyResponse } from '@coordinate/shared';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { SearchUnavailableError } from '../identify/identifier';
import { checkerJpeg, sampleItem } from '../test-utils';
import { FileUsageStore } from '../usage/usage-store';

const config = loadConfig({});
const response: IdentifyResponse = {
  itemId: 'item_1',
  verdict: 'unidentified',
  level: 'unidentified',
  rationale: '手がかりが足りず、商品を特定できませんでした',
  candidates: [],
  searches: { serpapi: 'ok', rakuten: 'ok' },
  comparison: 'skipped',
  queries: ['q'],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 1 },
  estimatedCostUsd: null,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  timings: { total: 5 },
};
const fakeIdentifier = (impl?: () => Promise<IdentifyResponse>) => {
  const f = { calls: 0, identify: async () => ((f.calls += 1), impl ? impl() : response) };
  return f;
};

function body(image: Buffer, fields: Record<string, string>, extraFile = false) {
  const b = '----t' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="c.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), image, Buffer.from('\r\n'));
  if (extraFile) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="d.jpg"\r\nContent-Type: image/jpeg\r\n\r\nxx\r\n`));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

const post = (app: ReturnType<typeof buildApp>, image: Buffer, fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const { payload, headers: h } = body(image, fields);
  return app.inject({ method: 'POST', url: '/v1/identify', payload, headers: { ...h, ...headers } });
};
const itemJson = JSON.stringify(sampleItem);
const install = { 'x-install-id': 'abcdef0123456789abcdef' };

describe('POST /v1/identify', () => {
  it('正常: 検証済みの応答を返す', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(200);
    expect(IdentifyResponseSchema.parse(res.json()).verdict).toBe('unidentified');
    expect(identifier.calls).toBe(1);
    await app.close();
  });
  it('識別器が無ければ 503 not_configured', async () => {
    const app = buildApp({ config, detector: null, identifier: null, usageStore: new FileUsageStore(null) });
    const res = await post(app, await checkerJpeg(), { item: itemJson }, install);
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('not_configured');
    await app.close();
  });
  it('item が無い・壊れている・形が違うなら 400 invalid_request。識別器を呼ばない', async () => {
    const identifier = fakeIdentifier();
    const app = buildApp({ config, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    for (const f of [{}, { item: '{not json' }, { item: JSON.stringify({ id: 'x' }) }]) {
      const res = await post(app, img, f, install);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_request');
    }
    expect(identifier.calls).toBe(0);
    await app.close();
  });
  it('画像でないファイルは 400 invalid_image', async () => {
    const app = buildApp({ config, detector: null, identifier: fakeIdentifier(), usageStore: new FileUsageStore(null) });
    const res = await post(app, Buffer.from('not an image'), { item: itemJson }, install);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_image');
    await app.close();
  });
  it('item 以外のフィールドや、ファイルの追加は拒否する', async () => {
    const app = buildApp({ config, detector: null, identifier: fakeIdentifier(), usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    expect((await post(app, img, { item: itemJson, extra: 'x' }, install)).statusCode).toBe(400);
    const { payload, headers } = body(img, { item: itemJson }, true);
    expect((await app.inject({ method: 'POST', url: '/v1/identify', payload, headers: { ...headers, ...install } })).statusCode).toBe(400);
    await app.close();
  });
  it('1 日の上限を超えたら 429 quota_exceeded。識別器を呼ばない', async () => {
    const identifier = fakeIdentifier();
    const cfg = { ...config, limits: { ...config.limits, identifyPerInstallPerDay: 1 } };
    const app = buildApp({ config: cfg, detector: null, identifier, usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    expect((await post(app, img, { item: itemJson }, install)).statusCode).toBe(200);
    const second = await post(app, img, { item: itemJson }, install);
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toBe('quota_exceeded');
    expect(identifier.calls).toBe(1);
    await app.close();
  });
  it('検索が使えないなら 503 search_unavailable、それ以外の失敗は 502 identify_failed', async () => {
    const mk = (impl: () => Promise<IdentifyResponse>) =>
      buildApp({ config, detector: null, identifier: fakeIdentifier(impl), usageStore: new FileUsageStore(null) });
    const img = await checkerJpeg();
    const a = mk(async () => {
      throw new SearchUnavailableError();
    });
    const ra = await post(a, img, { item: itemJson }, install);
    expect([ra.statusCode, ra.json().error]).toEqual([503, 'search_unavailable']);
    const b = mk(async () => {
      throw new Error('boom');
    });
    const rb = await post(b, img, { item: itemJson }, install);
    expect([rb.statusCode, rb.json().error]).toEqual([502, 'identify_failed']);
    await a.close();
    await b.close();
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api -- routes/identify` — Expected: FAIL

- [ ] **Step 3: `AppDeps` を拡張する** — `app.ts`

```ts
import type { Identifier } from './identify/identifier';
import type { UsageStore } from './usage/usage-store';

export type AppDeps = {
  config: Config;
  detector: Detector | null;
  /** null なら /v1/identify は 503。 */
  identifier?: Pick<Identifier, 'identify'> | null;
  usageStore?: UsageStore;
  logger?: boolean;
};
```

`buildApp` 内で `app.register(async (instance) => registerIdentifyRoute(instance, deps));` を追加し、`/health` の応答に `identifyConfigured: !!deps.identifier` を足す。`routes/analyze.ts` の `MESSAGES` を最終化する(`invalid_request: 'リクエストの内容が正しくありません。'`、`quota_exceeded: '本日の利用上限に達しました。明日またお試しください。'`、`search_unavailable: '商品検索が現在利用できません。'`、`identify_failed: '商品の特定に失敗しました。時間をおいて、もう一度お試しください。'`)。

- [ ] **Step 4: ルートの実装** — `routes/identify.ts`

```ts
import type { FastifyInstance } from 'fastify';

import { DetectedItemSchema, IdentifyResponseSchema, type DetectorImage } from '@coordinate/shared';

import type { AppDeps } from '../app';
import { SearchUnavailableError } from '../identify/identifier';
import { validateImage } from '../image/validate-image';
import { prepareForModel } from '../image/prepare-image';
import { FileUsageStore } from '../usage/usage-store';
import { sendError } from './analyze';

const INSTALL_ID = /^[A-Za-z0-9-]{16,64}$/;

export function registerIdentifyRoute(app: FastifyInstance, deps: AppDeps) {
  const store = deps.usageStore ?? new FileUsageStore(null);

  app.post('/v1/identify', { config: { rateLimit: {} } }, async (req, reply) => {
    let data: Buffer | undefined;
    let itemRaw: string | undefined;
    try {
      // item(JSON 文字列)1 つとファイル 1 つだけを受け付ける。
      for await (const part of req.parts({ limits: { fields: 1, files: 1, parts: 2, fileSize: deps.config.maxImageBytes } })) {
        if (part.type === 'file') {
          if (data) return sendError(reply, 400, 'invalid_image');
          data = await part.toBuffer();
          if (part.file.truncated) return sendError(reply, 400, 'too_large');
        } else {
          if (part.fieldname !== 'item' || itemRaw !== undefined) return sendError(reply, 400, 'invalid_request');
          itemRaw = typeof part.value === 'string' ? part.value : undefined;
        }
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'FST_REQ_FILE_TOO_LARGE'
        ? sendError(reply, 400, 'too_large')
        : sendError(reply, 400, 'invalid_request');
    }
    if (!data) return sendError(reply, 400, 'invalid_image');
    if (!validateImage(data).ok) return sendError(reply, 400, 'invalid_image');

    let item;
    try {
      const parsed = DetectedItemSchema.safeParse(JSON.parse(itemRaw ?? ''));
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');
      item = parsed.data;
    } catch {
      return sendError(reply, 400, 'invalid_request');
    }
    if (!deps.identifier) return sendError(reply, 503, 'not_configured');

    // 利用回数の上限(認証ではない。インストール ID と IP の両方で数える)。
    const now = new Date();
    const header = req.headers['x-install-id'];
    const installId = typeof header === 'string' && INSTALL_ID.test(header) ? header : null;
    const { identifyPerInstallPerDay, identifyPerIpPerDay } = deps.config.limits;
    if (
      !store.tryConsumeDaily(now, 'ip', req.ip, identifyPerIpPerDay) ||
      (installId && !store.tryConsumeDaily(now, 'install', installId, identifyPerInstallPerDay))
    ) {
      return sendError(reply, 429, 'quota_exceeded');
    }

    let image: DetectorImage;
    try {
      image = await prepareForModel(data);
    } catch {
      return sendError(reply, 400, 'invalid_image');
    }

    let result;
    try {
      result = await deps.identifier.identify(image, item);
    } catch (e) {
      // 画像・キー・検索語・上流の詳細はログに残さない。種類だけ記録する。
      req.log.error({ errorName: e instanceof Error ? e.name : 'unknown', status: (e as { status?: number }).status }, 'identify failed');
      return e instanceof SearchUnavailableError
        ? sendError(reply, 503, 'search_unavailable')
        : sendError(reply, 502, 'identify_failed');
    }

    store.addMonthly(now, { claudeInput: result.usage.claude.inputTokens, claudeOutput: result.usage.claude.outputTokens });
    req.log.info(
      {
        verdict: result.verdict,
        searches: result.searches,
        comparison: result.comparison,
        usage: result.usage,
        estimatedCostUsd: result.estimatedCostUsd,
      },
      'identified',
    );

    const parsed = IdentifyResponseSchema.safeParse(result);
    if (!parsed.success) {
      req.log.error({ errorName: 'ResponseSchemaMismatch' }, 'response validation failed');
      return sendError(reply, 502, 'identify_failed');
    }
    return reply.send(parsed.data);
  });
}
```

実装時の確認事項: (a) `req.parts(options)` が `limits` を受け取って `fields: 1` を適用するか。受け取らず、アプリ全体の `fields: 0` が効いて `item` が読めない場合は、`app.ts` の `multipart` の既定を `fields: 1, parts: 2` に上げ、`/v1/analyze` 側は既存のループ(`part.type !== 'file'` なら 400)が追加フィールドを拒否するので維持される。(b) 月間の SerpApi・楽天のカウントは各クライアントが記録する。Claude のトークンはここで記録する。

- [ ] **Step 5: 配線** — `server.ts` を拡張する

```ts
import Anthropic from '@anthropic-ai/sdk';

import { buildApp } from './app';
import { TtlCache } from './cache/ttl-cache';
import { loadConfig } from './config';
import { ClaudeVisionDetector } from './detector/claude-vision-detector';
import { Comparer } from './identify/comparer';
import { Identifier } from './identify/identifier';
import { QueryGenerator } from './identify/query-generator';
import { RakutenSearcher } from './search/rakuten';
import { SerpApiSearcher } from './search/serpapi';
import { FileUsageStore } from './usage/usage-store';
import type { Product } from '@coordinate/shared';

const config = loadConfig();
const anthropic = config.anthropicApiKey
  ? new Anthropic({ apiKey: config.anthropicApiKey, timeout: 60_000, maxRetries: 1 })
  : null;
const detector = anthropic ? new ClaudeVisionDetector(anthropic, config.model, config.effort) : null;

const usageStore = new FileUsageStore(config.usageFile);
const cache = () => new TtlCache<Product[]>({ ttlMs: config.limits.cacheTtlMs, maxEntries: 500 });
const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => fetch(url, init);

// 画像を検索するのではなく、テキスト検索の結果を Claude が画像で照合する。Claude が使えなければ特定は行わない。
const identifier = anthropic
  ? new Identifier({
      queryGenerator: new QueryGenerator(anthropic, config.model, config.effort),
      comparer: new Comparer(anthropic, config.model, config.effort),
      serpapi: new SerpApiSearcher({
        apiKey: config.serpapiKey,
        fetchImpl,
        cache: cache(),
        store: usageStore,
        monthlyLimit: config.limits.serpapiMonthly,
        timeoutMs: config.limits.searchTimeoutMs,
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
if (!detector) app.log.warn('ANTHROPIC_API_KEY が未設定です。/v1/analyze と /v1/identify は 503 を返します。');
if (!config.serpapiKey) app.log.warn('SERPAPI_API_KEY が未設定です。Google Shopping の検索は使えません。');
if (!config.rakuten) app.log.warn('楽天のキーが未設定です。楽天の検索は使えません。');
else if (!config.rakuten.affiliateId) app.log.warn('RAKUTEN_AFFILIATE_ID が未設定です。楽天のリンクは収益化されません。');

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

SerpApi の月間 80% 警告は、`SerpApiSearcher` の中で `used + 1 >= monthlyLimit * 0.8` を最初に越えたときに `console.warn` 相当で 1 度だけ出す形で、`SerpApiSearcher` に `onWarn?: (message: string) => void` を足して実装する(`server.ts` では `app.log.warn` を渡す)。テストは Task 5 のファイルに「80% に達したら警告を 1 度だけ出す」を 1 件足す。

- [ ] **Step 6: 通過と型検査** — Run: `npm test -w api && npm run typecheck -w api` — Expected: PASS(api 全体)
- [ ] **Step 7: Commit** — `feat(api): POST /v1/identify を追加し、検索・照合・上限を配線`

---

### Task 11: モバイル — API クライアント・状態・切り抜き

**Files:**
- Create: `apps/mobile/src/lib/install-id.ts`, `apps/mobile/src/lib/identify-api.ts`, `apps/mobile/src/features/analysis/crop-item.ts`
- Modify: `apps/mobile/src/features/analysis/analysis-reducer.ts`, `apps/mobile/src/lib/analyze-api.ts`
- Test: `apps/mobile/__tests__/identify-api.test.ts`, `apps/mobile/__tests__/analysis-reducer.test.ts`(追記)

- [ ] **Step 1: `analyze-api.ts` の `ERROR_MESSAGES` を最終化する**(Task 1 の暫定文言を、利用者向けの文言にそろえる)。`invalid_request: '送信する内容を作れませんでした。もう一度お試しください。'`、`quota_exceeded: '本日の商品検索の上限に達しました。明日またお試しください。'`、`search_unavailable: '商品検索が現在利用できません。時間をおいてお試しください。'`、`identify_failed: '商品を特定できませんでした。もう一度お試しください。'`。

- [ ] **Step 2: テスト(リデューサ)** — `analysis-reducer.test.ts` に追記

```ts
describe('商品特定の状態', () => {
  const done = analysisReducer(initialAnalysisState, { type: 'succeeded', response: sampleResponse });
  const id = (done as Extract<typeof done, { status: 'done' }>).items[0]!.id;
  const identified = { /* IdentifyResponse のサンプル。テスト内で定義する */ } as never;

  it('AI の項目は検出結果を保持し、特定の状態は idle から始まる', () => {
    const s = done as Extract<typeof done, { status: 'done' }>;
    expect(s.items[0]?.detected?.id).toBe(id);
    expect(s.items[0]?.identify).toEqual({ status: 'idle' });
  });
  it('開始 → 成功 / 失敗で状態が変わる', () => {
    const loading = analysisReducer(done, { type: 'identifyStart', id });
    expect(itemOf(loading, id).identify).toEqual({ status: 'loading' });
    const ok = analysisReducer(loading, { type: 'identifySucceeded', id, response: identified });
    expect(itemOf(ok, id).identify.status).toBe('done');
    const ng = analysisReducer(loading, { type: 'identifyFailed', id, kind: 'quota_exceeded' });
    expect(itemOf(ng, id).identify).toEqual({ status: 'failed', kind: 'quota_exceeded' });
  });
  it('カテゴリを変えたら、古い特定結果は破棄する', () => {
    const ok = analysisReducer(analysisReducer(done, { type: 'identifyStart', id }), { type: 'identifySucceeded', id, response: identified });
    expect(itemOf(analysisReducer(ok, { type: 'setCategory', id, categoryId: 'shoes_other' }), id).identify).toEqual({ status: 'idle' });
  });
  it('手動追加の項目は detected が null', () => {
    const added = analysisReducer(done, { type: 'addManual', id: 'm_1', categoryId: 'tshirt' });
    expect(itemOf(added, 'm_1').detected).toBeNull();
  });
});
```

(`sampleResponse` と `itemOf` は既存テストのヘルパーを使う。無ければ同ファイル内に定義する。)

- [ ] **Step 3: リデューサ実装** — `analysis-reducer.ts`

`ResultItem` に追加:

```ts
  /** 検出時のアイテム(特徴つき)。手動追加は null。 */
  detected: DetectedItem | null;
  identify: IdentifyState;
```

```ts
export type IdentifyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; kind: AnalyzeErrorKind }
  | { status: 'done'; response: IdentifyResponse };
```

`AnalysisAction` に `identifyStart` / `identifySucceeded` / `identifyFailed`(いずれも `id` つき)を追加し、`succeeded` で `detected: i` と `identify: { status: 'idle' }`、`addManual` で `detected: null` と `identify: { status: 'idle' }` を入れる。`setCategory` は `identify` を `{ status: 'idle' }` に戻す。`import type { DetectedItem, IdentifyResponse } from '@coordinate/shared'` を足す。`items-to-labels.test.ts` など `ResultItem` を組み立てる既存テストは、`detected: null, identify: { status: 'idle' }` を足して通るようにする。

- [ ] **Step 4: インストール ID** — `lib/install-id.ts`

```ts
import { File, Paths } from 'expo-file-system';

let cached: string | null = null;

function randomId(): string {
  const hex = () => Math.random().toString(16).slice(2, 10);
  return `${hex()}-${hex()}-${hex()}-${hex()}`;
}

/**
 * このインストールを区別する匿名の ID。利用回数の上限のために使う。個人情報ではなく、認証でもない。
 * 保存できなくても動作は続ける(その起動中だけの ID になる)。
 */
export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  try {
    const file = new File(Paths.document, 'install-id.txt');
    if (file.exists) {
      const text = (await file.text()).trim();
      if (/^[A-Za-z0-9-]{16,64}$/.test(text)) return (cached = text);
    }
    const id = randomId();
    file.create({ overwrite: true });
    file.write(id);
    return (cached = id);
  } catch {
    return (cached = randomId());
  }
}
```

実装時の確認事項: `expo-file-system` の SDK 57 の `File` / `Paths` の正確な API(`exists`、`text()`、`create`、`write`)を `node_modules/expo-file-system` の型定義で確認し、違えば合わせる。jest では `expo-file-system` をモックする(既存の `analyze-api.test.ts` のモック方法に合わせる)。

- [ ] **Step 5: 切り抜き** — `features/analysis/crop-item.ts`

```ts
import type { Box } from '@coordinate/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const PAD = 0.08;
const MIN_SIDE = 64;

/** 枠(写真全体に対する 0..1)に余白を足した画素の矩形。写真の外にはみ出さず、小さすぎる場合は広げる。 */
export function cropRect(box: Box, photo: { width: number; height: number }) {
  const x0 = Math.max(0, box.x - box.w * PAD);
  const y0 = Math.max(0, box.y - box.h * PAD);
  const x1 = Math.min(1, box.x + box.w * (1 + PAD));
  const y1 = Math.min(1, box.y + box.h * (1 + PAD));
  const originX = Math.floor(x0 * photo.width);
  const originY = Math.floor(y0 * photo.height);
  const width = Math.min(photo.width - originX, Math.max(MIN_SIDE, Math.ceil((x1 - x0) * photo.width)));
  const height = Math.min(photo.height - originY, Math.max(MIN_SIDE, Math.ceil((y1 - y0) * photo.height)));
  return { originX, originY, width, height };
}

/** アイテムの部分だけを切り抜いた JPEG の URI を作る。顔や背景を、必要以上に外部へ送らないため。 */
export async function cropItem(photo: { uri: string; width: number; height: number }, box: Box): Promise<string> {
  const rect = cropRect(box, photo);
  const cropped = await ImageManipulator.manipulate(photo.uri).crop(rect).renderAsync();
  const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return saved.uri;
}
```

`__tests__/crop-item.test.ts` に `cropRect` の純粋なテストを書く:枠の周りに 8% の余白が付くこと、写真の外にはみ出さないこと、極小の枠が最小 64px に広がること、右下の端でも範囲内に収まること。

- [ ] **Step 6: 識別 API クライアントのテスト** — `identify-api.test.ts`(`analyze-api.test.ts` の構造を踏襲。`expo-file-system` の `File` をモック)

```ts
import { sampleDetected, sampleIdentify } from './fixtures'; // 無ければ同ファイルに定義

describe('identifyItem', () => {
  it('image と item(JSON)と x-install-id を送り、検証済みの応答を返す', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => sampleIdentify }));
    const r = await identifyItem('file:///c.jpg', sampleDetected, { baseUrl: 'http://x', fetchImpl: fetchImpl as never, installId: 'abcdef0123456789abcdef' });
    expect(r.verdict).toBe(sampleIdentify.verdict);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: FormData }];
    expect(url).toBe('http://x/v1/identify');
    expect(init.headers['x-install-id']).toBe('abcdef0123456789abcdef');
    expect(init.body.get('item')).toBe(JSON.stringify(sampleDetected));
  });
  it('エラー応答はコードを AnalyzeError にする。不正な応答は identify_failed、通信失敗は network', async () => {
    const err = (status: number, json: unknown) => async () => ({ ok: false, status, json: async () => json });
    await expect(identifyItem('f', sampleDetected, { baseUrl: 'http://x', installId: 'a'.repeat(20), fetchImpl: err(429, { error: 'quota_exceeded', message: 'm' }) as never })).rejects.toMatchObject({ kind: 'quota_exceeded' });
    await expect(identifyItem('f', sampleDetected, { baseUrl: 'http://x', installId: 'a'.repeat(20), fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never })).rejects.toMatchObject({ kind: 'identify_failed' });
    await expect(identifyItem('f', sampleDetected, { baseUrl: 'http://x', installId: 'a'.repeat(20), fetchImpl: (async () => { throw new Error('x'); }) as never })).rejects.toMatchObject({ kind: 'network' });
  });
  it('ベース URL が無ければ not_configured', async () => {
    await expect(identifyItem('f', sampleDetected, { baseUrl: '', installId: 'a'.repeat(20) })).rejects.toMatchObject({ kind: 'not_configured' });
  });
});
```

(`FormData.get` が jest-expo の環境で使えない場合は、`body.append` を spy する形に変える。)

- [ ] **Step 7: 識別 API クライアントの実装** — `lib/identify-api.ts`

```ts
import { ApiErrorSchema, IdentifyResponseSchema, type DetectedItem, type IdentifyResponse } from '@coordinate/shared';
import { File } from 'expo-file-system';

import { AnalyzeError } from './analyze-api';
import { getInstallId } from './install-id';

type Options = { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; installId?: string };

/** 切り抜き画像 1 枚と、そのアイテムの検出結果を送り、商品の候補と判定を受け取る。 */
export async function identifyItem(cropUri: string, item: DetectedItem, options: Options = {}): Promise<IdentifyResponse> {
  const baseUrl = options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new AnalyzeError('not_configured');
  const doFetch = options.fetchImpl ?? fetch;
  const installId = options.installId ?? (await getInstallId());

  const form = new FormData();
  form.append('item', JSON.stringify(item));
  // Expo の fetch は RN 形式の { uri } を受け付けない。Blob を実装する expo-file-system の File を使う。
  form.append('image', new File(cropUri));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl.replace(/\/$/, '')}/v1/identify`, {
      method: 'POST',
      headers: { 'x-install-id': installId },
      body: form,
      signal: controller.signal,
    });
  } catch {
    throw new AnalyzeError('network');
  } finally {
    clearTimeout(timer);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AnalyzeError('identify_failed');
  }
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(body);
    throw new AnalyzeError(err.success ? err.data.error : 'identify_failed');
  }
  const parsed = IdentifyResponseSchema.safeParse(body);
  if (!parsed.success) throw new AnalyzeError('identify_failed');
  return parsed.data;
}
```

注意: `form.append('image', new File(...))` はファイル名を持たない場合がある。サーバーは `part.type === 'file'` で受けるので、`File` の `name` が空でも通るかを実機(エミュレータ)で確認する(Task 13)。

- [ ] **Step 8: 通過と型検査** — Run: `npm test -w mobile && npm run typecheck -w mobile` — Expected: PASS(mobile 全体。既存 73 件を含む)
- [ ] **Step 9: Commit** — `feat(mobile): 商品特定の API クライアント・状態・切り抜きを追加`

---

### Task 12: モバイル — 結果画面の「商品を探す」と候補表示

**Files:**
- Create: `apps/mobile/src/components/product-candidates.tsx`
- Modify: `apps/mobile/src/app/result.tsx`
- Test: `apps/mobile/__tests__/screens.test.tsx`(追記)、`apps/mobile/__tests__/product-candidates.test.tsx`

- [ ] **Step 1: 候補表示コンポーネントのテスト** — 表示の約束事を検証する

```tsx
describe('ProductCandidates', () => {
  it('A: 「特定できました」と、一致した点・未確認の点を出す', () => {/* verdict identified の応答を描画し、文言を確認 */});
  it('B: 「候補」と見出しを付け、「同じ商品とは確認できていません」と書く', () => {});
  it('C: 「特定できませんでした」と書き、商品名やブランドを作らない', () => {});
  it('価格には種別と取得日時(「○月○日時点」)が付き、価格が無い候補は「価格は取得できませんでした」', () => {});
  it('購入先のリンクは、Google の商品ページなら「Google ショッピングで見る(販売元: ○○)」、楽天なら「楽天市場で見る」', () => {});
  it('楽天の結果が使えたときは「Supported by Rakuten Developers」を出す。使えなかった検索は理由を出す', () => {});
  it('比較に失敗した候補には「画像との照合ができませんでした」が出る', () => {});
});
```

各テストは、具体的な `IdentifyResponse` を組み立てて `render` し、`screen.getByText` で文言を確認する形で実装する(文言は下の実装と一致させる)。

- [ ] **Step 2: 実装** — `components/product-candidates.tsx`

表示内容(文言はこのとおりにする):
- 見出し: A →「特定できました」、B →「候補が見つかりました」、C →「特定できませんでした」。
- B の補足: 「似ている商品です。同じ商品とは確認できていません。」C の補足: 「写真から読み取れる手がかりが足りず、商品名やブランドは決められませんでした。」
- 各候補: サムネイル(`expo-image`、あれば)、商品名、価格(`¥7,590` 形式。下に `「楽天市場の販売価格 / Google ショッピングの表示価格」 ・ 10月18日時点`)、販売元、「一致した点: …」「確認できていない点: …」、リンク(下記)。価格が無ければ「価格は取得できませんでした」。
- リンク:
  - `google_shopping` →「Google ショッピングで見る」。販売元があれば `(販売元: ${seller})` を添える。
  - `rakuten` →「楽天市場で見る」。
  - `Linking.openURL(pageUrl)`、`accessibilityRole="link"`。
- 検索の状態: `searches.serpapi !== 'ok'` や `searches.rakuten !== 'ok'` のとき、「Google ショッピングの検索は未設定です / 今月の上限に達しました / 失敗しました」のように、使えなかった検索を一行で出す。
- 楽天の検索が `ok` のとき、末尾に楽天のクレジット `Supported by Rakuten Developers` を出す。タップで `https://developers.rakuten.com` を開く(楽天のテキスト表示の指定)。
- 確信度の数値は出さない(`matchScore` は並び順にだけ使う)。

実装は `ThemedText` / `Spacing` / `useTheme` を使い、`result.tsx` のカード(`styles.card`)に合わせる。価格の整形は純関数 `formatPrice(amount, currency)` と `formatAsOf(iso)`(`10月18日時点`)に分けてテストする。

- [ ] **Step 3: `result.tsx` を変更する**

`ItemCard` に、AI の項目(`item.detected !== null`)だけ、ブランド欄の下に「商品を探す」ボタン(`AppButton` の `variant="secondary"`)を追加する。状態ごとの表示:
- `idle` → 「商品を探す」(`accessibilityLabel`: `${name}の商品を探す`)。
- `loading` → ボタンを無効にし、`ActivityIndicator` と「探しています」。
- `failed` → `ERROR_MESSAGES[kind]` を `accessibilityRole="alert"` で出し、「もう一度探す」ボタン。
- `done` → `ProductCandidates` と「もう一度探す」(回数の消費を避けるため、押すと確認はせず、再実行する。キャッシュは API 側にある)。

押したときの処理(`ResultScreen` 内):

```tsx
const search = async (it: ResultItem) => {
  if (!it.detected || !snapshot) return;
  dispatch({ type: 'identifyStart', id: it.id });
  try {
    const cropUri = await cropItem(snapshot.photo, it.box);
    const response = await identifyItem(cropUri, { ...it.detected, categoryId: it.categoryId });
    dispatch({ type: 'identifySucceeded', id: it.id, response });
  } catch (e) {
    dispatch({ type: 'identifyFailed', id: it.id, kind: e instanceof AnalyzeError ? e.kind : 'identify_failed' });
  }
};
```

`cropItem` は `snapshot.photo`(解析に使った写真全体)の枠から切り抜く。ユーザーがカテゴリを変えた場合は、変更後の `categoryId` を送る。

- [ ] **Step 4: 画面テストを追記する** — `screens.test.tsx`

`identifyItem` と `cropItem` をモックし、次を検証する:
1. AI の項目に「商品を探す」ボタンがあり、手動追加の項目には無い。
2. 押すと `identifyItem` が呼ばれ、読み込み表示のあと候補が出る。
3. 失敗すると、日本語のエラー文言が出て、「もう一度探す」で再実行できる。
4. 上限超過(`quota_exceeded`)の文言が出る。
5. 二度押しで `identifyItem` が二重に呼ばれない(読み込み中はボタンが無効)。
6. 「この内容で編集へ」の動作は、変わらない。

- [ ] **Step 5: 通過と型検査** — Run: `npm test -w mobile && npm run typecheck -w mobile` — Expected: PASS
- [ ] **Step 6: Commit** — `feat(mobile): 結果画面に「商品を探す」と候補の表示を追加`

---

### Task 13: 評価スクリプト・設定例・実機確認・記録

**Files:**
- Create: `apps/api/scripts/eval-identify.ts`
- Modify: `apps/api/package.json`(`"eval:identify": "tsx --env-file=.env scripts/eval-identify.ts"`)、`.env.example`、`docs/progress.md`、`docs/limitations.md`
- Create: `docs/phase4-evaluation.md`

- [ ] **Step 1: 評価スクリプト** — `scripts/eval-identify.ts`

`scripts/eval.ts` の構造を踏襲する。流れ:
1. `loadConfig()`。`anthropicApiKey` が無ければ終了。SerpApi・楽天のキーの有無を表示する。
2. `eval/photos/*.jpg|png` を、引数 `--max-searches N`(既定 40)と `--photos a,b`(任意)で絞る。
3. 各写真を `validateImage` → `prepareForModel` → `ClaudeVisionDetector.detect`。各アイテムを `sharp` で切り抜く(`box` に 8% の余白、最小 64px)。
4. 各アイテムを `Identifier.identify`(実クライアント、`FileUsageStore(null)`、`SerpApiSearcher` の `monthlyLimit` は `--max-searches`)。SerpApi の呼び出し合計が上限に達したら、残りのアイテムは SerpApi を使わず `budget_exhausted` として評価する。
5. 表: `file / item / category / brandRead / verdict / candidates / top candidate / serp / rakuten / comparison / usd`。1 アイテムあたりの原価の平均と、A・B・C の件数を出す。
6. `eval/results/identify-<stamp>.json` に詳細(候補の名前・販売元・`matched`/`unconfirmed`)を保存する。
7. エラーは種類だけを表示し、キーや画像を出さない。

- [ ] **Step 2: 設定例** — `.env.example` の api セクションに追記する

```
# --- Phase 4: 商品特定(サーバーのみ) ---
SERPAPI_API_KEY=REPLACE_ME
# SerpApi の月間検索の上限(無料枠は 250)。到達すると SerpApi を止める。80% でログに警告。
SERPAPI_MONTHLY_LIMIT=200
# 1 検索あたりの概算 USD(プランの月額 ÷ 検索数)。未設定なら費用に含めない。
SERPAPI_COST_PER_SEARCH_USD=
# 楽天ウェブサービス(applicationId と accessKey の両方が必要)
RAKUTEN_APPLICATION_ID=REPLACE_ME
RAKUTEN_ACCESS_KEY=REPLACE_ME
# 楽天アフィリエイト ID。未設定ならリンクは収益化されない。
RAKUTEN_AFFILIATE_ID=
# 検索結果のメモリキャッシュ(秒)
SEARCH_CACHE_TTL_SECONDS=3600
# 1 日あたりの商品特定の回数(インストール ID あたり。IP は 3 倍)
IDENTIFY_DAILY_LIMIT=30
# 使用量(数値のみ)の保存先
USAGE_FILE=data/usage.json
```

- [ ] **Step 3: 全体のテストと型検査** — Run: `npm test --workspaces --if-present && npm run typecheck --workspaces --if-present` — Expected: すべて PASS

- [ ] **Step 4: 実 API の評価を実行する** — Run: `npm run eval:identify -w api -- --max-searches 40`
  結果の表を確認し、**目視で写真と照らして**、候補が実際に正しいかを判断する(写真は `apps/api/eval/photos/`)。A が出たアイテムは、特に誤りがないかを確認する。誤った A があれば、ここで止めて原因を調べ、判定ルール(Task 8)を直す。A・B・C の件数、1 アイテムあたりの原価、SerpApi の使用回数を記録する。

- [ ] **Step 5: エミュレータで通しを確認する**(ユーザーが起動を許可したときのみ)
  1. API サーバーを `npm run start -w api` で起動し、`/health` の `identifyConfigured` が true であることを確認する。
  2. エミュレータで写真 → 解析 → 結果画面 → 「商品を探す」を押す。候補または C が出ること、楽天のクレジットが出ること、リンクが開くことを確認する。
  3. 切り抜き画像の添付(`File` に名前が無い場合)がサーバーで受け付けられることを確認する。
  4. 上限を `IDENTIFY_DAILY_LIMIT=1` にして再起動し、2 回目で上限の文言が出ることを確認する。
  5. SerpApi のキーを外して再起動し、「Google ショッピングの検索は未設定です」と出て、楽天だけで動くことを確認する。
  エミュレータの `adb shell` が固まったら、再試行せずユーザーに伝える。

- [ ] **Step 6: 記録** — `docs/phase4-evaluation.md` に、評価の結果(件数、原価の計算根拠、誤りの事例、A の基準が厳しすぎるか)と、確認できなかった点を書く。`docs/progress.md` を Phase 4 完了(または未完了の項目を明記)に更新し、`docs/limitations.md` に既知の制約を追記する:
  - 手動追加のアイテムでは商品を探せない。
  - Google Shopping のリンクは販売店ではなく Google の商品ページ。
  - ユーザーが入力したブランドは、検索にも判定にも使わない。
  - 上限は認証ではなく、匿名のインストール ID と IP で数える。
  - SerpApi の商用利用の条件は未確認。
  - 文字が読めないアイテムは、ほとんど B か C になる。

- [ ] **Step 7: Commit** — `docs: Phase 4 の評価結果と進捗を記録`

---

## Self-Review(計画の自己点検)

**設計書との対応**: 範囲(1 章)→ Task 1〜12。流れ(2 章)→ Task 7〜10。判定(3 章)→ Task 8、`verdictToLevel` は Task 1。費用・上限・保存(4 章)→ Task 2〜6、10。セキュリティ・未設定(5 章)→ Task 5/6(未設定・許可ドメイン)、Task 10(入力検証・ログ)。モバイル(6 章)→ Task 11〜12。テスト・評価(7〜8 章)→ 各 Task と Task 13。確認が残る点(9 章)→ Task 13 の記録。

**差分の明記**: JSON ファイル(SQLite でなく)、検索語はテキストのみ、`product_link` が Google の商品ページ、手動項目は対象外。いずれも冒頭に書いた。

**名前の整合**: `IdentifyResponse`、`IdentifyCandidate`、`Judgement`、`decideVerdict`、`SearchOutcome`/`ProductSearcher`、`Identifier`、`SearchUnavailableError`、`FileUsageStore`/`UsageStore`、`TtlCache`、`isAllowedImageUrl` を全 Task で同じ綴りで使っている。`ProductSchema` への `seller` 追加は Task 5 の注記にあるが、Task 1 で一緒に入れること(Task 1 のステップ 3 に `seller: z.string().optional()` を加える)。

**既知のリスク(実装時に確認)**: (1) `req.parts(options)` の `limits` の効き方(Task 10)。(2) Anthropic SDK の URL 画像ソースの型(Task 8)。(3) `expo-file-system` の `File`/`Paths` の API(Task 11)。(4) Anthropic が候補のサムネイル URL を取得できない場合は、照合が失敗として `comparison: 'failed'` になる(Task 9 で扱い済み)。実 API の評価(Task 13)で頻度を測る。
