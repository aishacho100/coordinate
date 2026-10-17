# Phase 3 AI アイテム検出 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コーデ写真 1 枚を `apps/api` へ送り、Claude Vision で着用アイテムを検出して、認識結果画面で確認・修正してから編集画面のラベルへ引き継げるようにする。

**Architecture:** `apps/api`(Fastify)が画像検証 → 品質評価(sharp)→ `Detector`(Claude Vision、構造化出力)を実行し、結果・トークン数・処理時間を返す。アプリは `analyzing` 画面で API を呼び、`result` 画面で修正し、確定したアイテムを正規化座標のラベルとして編集画面へ渡す。型とレスポンスの zod スキーマは `packages/shared` で共有する。

**Tech Stack:** TypeScript 6、Fastify 5 + `@fastify/multipart` + `@fastify/rate-limit`、sharp、`@anthropic-ai/sdk`、zod 4、jest + ts-jest(api / shared / layout)、jest-expo + RNTL v13(mobile)、tsx(api の実行)。

設計: `docs/superpowers/specs/2026-10-15-phase3-detection-design.md`。要件の背景: `docs/product-identification-requirements.md`。

## 前提と方針(全タスク共通)

- 回答・コミットメッセージ・コメントは日本語。コードの識別子は英語。既存コードのコメント密度と文体に合わせる。
- コミットは `git commit -m "<件名>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` の形で行う。
- **API キーは `apps/api/.env`(Git 管理外)のみ。チャット・ログ・コミットに出さない。** 実 Claude を呼ぶのは Task 13 だけ。それ以外のテストはすべてモック。
- **モックの成功を「AI 解析が動いた」と報告しない。** 実機・エミュレータで実 Claude を呼んだ結果は Task 13 で別に記録する。
- ダミー商品は作らない。Phase 3 では商品・価格を出さない(`candidates: []`)。
- `react` は 19.2.3 固定、RNTL は v13。`expo install` は使わず `npm install -w <workspace> pkg@版` を使う(`docs/progress.md` の注意点)。
- モデルは `ANTHROPIC_MODEL` で切替。Sonnet 5.5 は **`tool_choice` の強制が 400** になるため、ツール呼び出しではなく **構造化出力(`output_config.format` の `json_schema`)** を使う。設計書の「ツール呼び出し」はこの方式に読み替える(結果は同じく zod で再検証する)。
- Claude の `refusal` は 502(`analysis_failed`)として扱い、サーバー側フォールバックは使わない(コスト管理のため。実測で refusal が出るなら再検討)。
- 作業ディレクトリはリポジトリルート `C:\work\app\coordinate`。コマンドは Git Bash 構文。

## ファイル構成

```
packages/shared/src/analyze.ts            新規  解析レスポンス/エラー/Detector のスキーマと型
packages/shared/src/analyze.test.ts       新規
packages/shared/src/index.ts              変更  analyze を export
packages/layout/src/document.ts           変更  NewLabelInput に anchor/position(任意)
packages/layout/src/layout.test.ts        変更  上記のテスト追加

apps/api/package.json / tsconfig.json / jest.config.js
apps/api/src/config.ts (+ .test.ts)       環境変数の読み込み
apps/api/src/test-utils.ts                テスト用の画像生成・multipart 生成・偽 Detector
apps/api/src/image/validate-image.ts (+ .test.ts)   形式判定(JPEG/PNG)
apps/api/src/image/prepare-image.ts (+ .test.ts)    Claude 用に長辺 1568px へ縮小
apps/api/src/image/quality.ts (+ .test.ts)          解像度・明るさ・ぶれ
apps/api/src/detector/schema.ts           Claude 出力の JSON Schema と zod
apps/api/src/detector/prompt.ts           システムプロンプト
apps/api/src/detector/normalize.ts (+ .test.ts)     検証・破棄・ブランド根拠・DetectedItem 化
apps/api/src/detector/claude-vision-detector.ts (+ .test.ts)
apps/api/src/usage.ts (+ .test.ts)        費用概算とログ
apps/api/src/app.ts / routes/analyze.ts (+ .test.ts)
apps/api/src/server.ts                    起動
apps/api/scripts/eval.ts                  実 Claude を呼ぶ評価(キーが無ければスキップ)

apps/mobile/src/lib/analyze-api.ts (+ __tests__/analyze-api.test.ts)
apps/mobile/src/features/analysis/analysis-reducer.ts / analysis-context.tsx
apps/mobile/src/features/analysis/items-to-labels.ts
apps/mobile/__tests__/analysis-reducer.test.ts / items-to-labels.test.ts
apps/mobile/src/features/editor/reducer.ts            変更  addLabels アクション
apps/mobile/src/features/editor/editor-context.tsx    変更  initialState(テスト用)
apps/mobile/src/app/analyzing.tsx / result.tsx / index.tsx / _layout.tsx   変更
apps/mobile/__tests__/screens.test.tsx                変更
```

---

### Task 1: shared に解析のスキーマと型を追加

**Files:**
- Create: `packages/shared/src/analyze.ts`
- Create: `packages/shared/src/analyze.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/src/analyze.test.ts`:

```ts
import { AnalyzeResponseSchema, ApiErrorSchema, type DetectedItem } from './index';

const item: DetectedItem = {
  id: 'item_1',
  categoryId: 'tshirt',
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
  appearance: { colors: ['白'], visibleText: [], notes: undefined },
  brandCandidates: [],
  candidates: [],
  confidence: { detection: 0.9, category: 0.8, brand: null, model: null, variant: null, price: null },
  level: 'unidentified',
  reviewState: 'auto',
  rationale: 'ブランドを示す文字・ロゴが確認できませんでした',
  modelVersion: 'claude-sonnet-5-5',
};

const base = {
  quality: { ok: true, issues: [] },
  items: [item],
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1500, outputTokens: 400 },
  timings: { quality: 30, detect: 4200, total: 4300 },
};

describe('analyze schemas', () => {
  it('正常なレスポンスを受け入れる(検出 0 件も可)', () => {
    expect(AnalyzeResponseSchema.safeParse(base).success).toBe(true);
    expect(AnalyzeResponseSchema.safeParse({ ...base, items: [] }).success).toBe(true);
  });

  it('品質の issue に未知の値があれば拒否する', () => {
    const bad = { ...base, quality: { ok: false, issues: ['weird'] } };
    expect(AnalyzeResponseSchema.safeParse(bad).success).toBe(false);
  });

  it('負のトークン数・不正なアイテムを拒否する', () => {
    expect(AnalyzeResponseSchema.safeParse({ ...base, usage: { inputTokens: -1, outputTokens: 0 } }).success).toBe(false);
    expect(AnalyzeResponseSchema.safeParse({ ...base, items: [{ id: 'x' }] }).success).toBe(false);
  });

  it('エラーボディは既知のコードのみ', () => {
    expect(ApiErrorSchema.safeParse({ error: 'not_configured', message: 'm' }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: 'boom', message: 'm' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -w @coordinate/shared`
Expected: FAIL(`AnalyzeResponseSchema` が無い)

- [ ] **Step 3: 実装**

`packages/shared/src/analyze.ts`:

```ts
import { z } from 'zod';

import { DetectedItemSchema, type DetectedItem } from './item';

export const QualityIssueSchema = z.enum(['low_resolution', 'too_dark', 'blurry', 'not_full_body']);
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const QualitySchema = z.object({ ok: z.boolean(), issues: z.array(QualityIssueSchema) });
export type Quality = z.infer<typeof QualitySchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

/** POST /v1/analyze の成功レスポンス。タイミングは ms。 */
export const AnalyzeResponseSchema = z.object({
  quality: QualitySchema,
  items: z.array(DetectedItemSchema),
  model: z.string().min(1),
  usage: UsageSchema,
  timings: z.object({
    quality: z.number().nonnegative(),
    detect: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const ApiErrorCodeSchema = z.enum([
  'invalid_image',
  'too_large',
  'analysis_failed',
  'not_configured',
  'rate_limited',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({ error: ApiErrorCodeSchema, message: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type DetectorImage = { data: Uint8Array; mediaType: 'image/jpeg' | 'image/png' };

export type DetectorResult = {
  items: DetectedItem[];
  /** 頭から足元まで写っているか(モデルの判定)。 */
  fullBody: boolean;
  /** 実際に応答したモデル名。 */
  model: string;
  usage: Usage;
};

/** アイテム検出の差し替え口。Phase 3 の実装は Claude Vision。 */
export interface Detector {
  detect(image: DetectorImage): Promise<DetectorResult>;
}

/** 費用管理用のログ 1 件。画像・API キーは含めない。 */
export type UsageRecord = Usage & { model: string; detectMs: number };
```

`packages/shared/src/index.ts` を次のようにする:

```ts
export * from './item';
export * from './edit';
export * from './analyze';
```

- [ ] **Step 4: 通過を確認**

Run: `npm test -w @coordinate/shared && npm run typecheck -w @coordinate/shared`
Expected: PASS(shared 7 件)、型エラーなし

- [ ] **Step 5: コミット**

```bash
git add packages/shared
git commit -m "feat(shared): 解析レスポンスとDetectorのスキーマを追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: layout の addLabel に初期位置を渡せるようにする

**Files:**
- Modify: `packages/layout/src/document.ts`(`NewLabelInput` と `addLabel`)
- Modify: `packages/layout/src/layout.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`packages/layout/src/layout.test.ts` の `addLabel` を使う describe 内(既存の `addLabel(base, { id: 'a' })` のテストの近く)に追加:

```ts
  it('anchor と position を指定でき、0〜1 に丸められる', () => {
    const d = addLabel(base, {
      id: 'p',
      anchor: { x: 0.3, y: 1.4 },
      position: { x: 0.05, y: 0.2 },
    });
    expect(d.labels[0]?.anchor).toEqual({ x: 0.3, y: 1 });
    expect(d.labels[0]?.position).toEqual({ x: 0.05, y: 0.2 });
  });

  it('指定が無ければ従来どおり既定の配置になる', () => {
    const d = addLabel(base, { id: 'q' });
    expect(d.labels[0]?.position).toEqual({ x: 0.05, y: 0.1 });
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -w @coordinate/layout`
Expected: FAIL(anchor が既定値のまま)/型エラー

- [ ] **Step 3: 実装**

`packages/layout/src/document.ts` の `NewLabelInput` と `addLabel` を変更:

```ts
export type NewLabelInput = {
  id: string;
  itemId?: string | null;
  brand?: string;
  name?: string;
  price?: string;
  /** 省略時は defaultSlot。指定時は 0〜1 に丸める。 */
  anchor?: Point;
  position?: Point;
};

export function addLabel(doc: EditDocument, input: NewLabelInput): EditDocument {
  if (doc.labels.some((l) => l.id === input.id)) throw new Error(`ラベルIDが重複しています: ${input.id}`);
  const slot = defaultSlot(doc.labels.length);
  const label: Label = {
    id: input.id,
    itemId: input.itemId ?? null,
    anchor: input.anchor ? clampPoint(input.anchor) : slot.anchor,
    position: input.position ? clampPoint(input.position) : slot.position,
    brand: input.brand ?? '',
    name: input.name ?? '',
    price: input.price ?? '',
    show: { brand: true, name: true, price: true },
    visible: true,
    style: {},
  };
  return { ...doc, labels: [...doc.labels, label] };
}
```

- [ ] **Step 4: 通過を確認**

Run: `npm test -w @coordinate/layout && npm run typecheck -w @coordinate/layout`
Expected: PASS(layout 43 件)

- [ ] **Step 5: コミット**

```bash
git add packages/layout
git commit -m "feat(layout): ラベル追加時に初期位置を指定できるようにする" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: apps/api の土台(設定・ヘルスチェック)

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/jest.config.js`
- Create: `apps/api/src/config.ts`, `apps/api/src/config.test.ts`
- Create: `apps/api/src/app.ts`(この段階ではヘルスチェックのみ。`apps/api/src/app.test.ts` も)
- Modify: `.env.example`, `.gitignore`

- [ ] **Step 1: パッケージを作る**

`apps/api/package.json`:

```json
{
  "name": "api",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/server.ts",
    "start": "tsx --env-file=.env src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "eval": "tsx --env-file=.env scripts/eval.ts"
  },
  "dependencies": {
    "@coordinate/shared": "*"
  }
}
```

`apps/api/tsconfig.json`(shared と同じ方針):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["jest", "node"]
  },
  "include": ["src", "scripts"]
}
```

`apps/api/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          strict: true,
          noUncheckedIndexedAccess: true,
          esModuleInterop: true,
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
};
```

依存を入れる:

```bash
npm install -w api fastify @fastify/multipart @fastify/rate-limit sharp @anthropic-ai/sdk zod
npm install -w api -D tsx jest ts-jest @types/jest @types/node typescript
```

Expected: `package-lock.json` が更新される。`npm ls react` で 19.2.3 のままであることを確認する(混入していれば `docs/progress.md` の注意点に従って対処)。

`.gitignore` の末尾に追記:

```
# 実 Claude の評価用(手元の写真と結果。コミットしない)
apps/api/eval/
```

`.env.example` の `apps/api` 節を次のように置き換える:

```
# --- apps/api (サーバー側のみ。秘密情報はここ) ---
# Anthropic Console で発行したキーを apps/api/.env に設定する。チャットやコミットに貼らない。
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
# 既定は Sonnet 5.5。Task 13 の実測の後に確定する。
ANTHROPIC_MODEL=claude-sonnet-5-5
# 思考の深さ(low | medium | high)。検出は medium を初期値にする。
ANTHROPIC_EFFORT=medium
PORT=8787
# IP あたり 1 分間の解析回数(簡易。本格対応は Phase 6)
RATE_LIMIT_PER_MINUTE=20
# 費用の概算用。USD / 100 万トークン。未設定なら概算を出さない(料金表はソースに固定しない)。
PRICE_INPUT_PER_MTOK=
PRICE_OUTPUT_PER_MTOK=
```

- [ ] **Step 2: config の失敗するテストを書く**

`apps/api/src/config.test.ts`:

```ts
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('未設定なら既定値とキー無し(null)になる', () => {
    const c = loadConfig({});
    expect(c.anthropicApiKey).toBeNull();
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(c.effort).toBe('medium');
    expect(c.port).toBe(8787);
    expect(c.maxImageBytes).toBe(10 * 1024 * 1024);
    expect(c.ratePerMinute).toBe(20);
    expect(c.pricing).toBeNull();
  });

  it('空文字のキーは未設定として扱う', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: '  ' }).anthropicApiKey).toBeNull();
  });

  it('環境変数を読み取る', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_MODEL: 'claude-haiku-5-5',
      ANTHROPIC_EFFORT: 'low',
      PORT: '9000',
      RATE_LIMIT_PER_MINUTE: '5',
      PRICE_INPUT_PER_MTOK: '2',
      PRICE_OUTPUT_PER_MTOK: '10',
    });
    expect(c).toMatchObject({
      anthropicApiKey: 'k',
      model: 'claude-haiku-5-5',
      effort: 'low',
      port: 9000,
      ratePerMinute: 5,
      pricing: { inputPerMTok: 2, outputPerMTok: 10 },
    });
  });

  it('不正な effort・数値は既定値に戻す', () => {
    const c = loadConfig({ ANTHROPIC_EFFORT: 'turbo', PORT: 'abc', PRICE_INPUT_PER_MTOK: '2' });
    expect(c.effort).toBe('medium');
    expect(c.port).toBe(8787);
    expect(c.pricing).toBeNull(); // 片方だけでは概算しない
  });
});
```

- [ ] **Step 3: 失敗を確認** — Run: `npm test -w api` → FAIL(`./config` が無い)

- [ ] **Step 4: 実装**

`apps/api/src/config.ts`:

```ts
export type Effort = 'low' | 'medium' | 'high';

export type Config = {
  port: number;
  /** null ならキー未設定(解析は 503)。値はログに出さない。 */
  anthropicApiKey: string | null;
  model: string;
  effort: Effort;
  maxImageBytes: number;
  ratePerMinute: number;
  /** 費用概算用。両方そろった場合のみ。 */
  pricing: { inputPerMTok: number; outputPerMTok: number } | null;
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

function positiveNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const effort = EFFORTS.find((e) => e === env.ANTHROPIC_EFFORT) ?? 'medium';
  const priceIn = positiveNumber(env.PRICE_INPUT_PER_MTOK);
  const priceOut = positiveNumber(env.PRICE_OUTPUT_PER_MTOK);
  return {
    port: positiveNumber(env.PORT) ?? 8787,
    anthropicApiKey: key ? key : null,
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5',
    effort,
    maxImageBytes: 10 * 1024 * 1024,
    ratePerMinute: positiveNumber(env.RATE_LIMIT_PER_MINUTE) ?? 20,
    pricing: priceIn !== null && priceOut !== null ? { inputPerMTok: priceIn, outputPerMTok: priceOut } : null,
  };
}
```

- [ ] **Step 5: ヘルスチェックの失敗するテストを書く**

`apps/api/src/app.test.ts`:

```ts
import { buildApp } from './app';
import { loadConfig } from './config';

describe('GET /health', () => {
  it('稼働状態と、検出器が設定済みかどうかを返す', async () => {
    const app = buildApp({ config: loadConfig({}), detector: null });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, detectorConfigured: false });
    await app.close();
  });
});
```

- [ ] **Step 6: 実装**

`apps/api/src/app.ts`(ルートは Task 7 で追加する):

```ts
import Fastify, { type FastifyInstance } from 'fastify';

import type { Detector } from '@coordinate/shared';

import type { Config } from './config';

export type AppDeps = {
  config: Config;
  /** null ならキー未設定。解析は 503 を返す。 */
  detector: Detector | null;
  logger?: boolean;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.get('/health', async () => ({ ok: true, detectorConfigured: deps.detector !== null }));

  return app;
}
```

- [ ] **Step 7: 通過を確認**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS(config 4 + app 1)、型エラーなし

- [ ] **Step 8: コミット**

```bash
git add apps/api package.json package-lock.json .env.example .gitignore
git commit -m "feat(api): Fastify の土台と環境変数の読み込みを追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 画像の検証と縮小

**Files:**
- Create: `apps/api/src/test-utils.ts`
- Create: `apps/api/src/image/validate-image.ts`, `validate-image.test.ts`
- Create: `apps/api/src/image/prepare-image.ts`, `prepare-image.test.ts`

- [ ] **Step 1: テスト用ユーティリティを書く**

`apps/api/src/test-utils.ts`:

```ts
import sharp from 'sharp';

import type { DetectedItem, Detector, DetectorResult } from '@coordinate/shared';

/** 市松模様の JPEG。エッジが多く、明るさも十分なので品質評価を通る。 */
export async function checkerJpeg(width = 1000, height = 1000, cell = 8): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw[y * width + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 220 : 40;
    }
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
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/api/src/image/validate-image.test.ts`:

```ts
import { checkerJpeg, flatPng } from '../test-utils';
import { validateImage } from './validate-image';

describe('validateImage', () => {
  it('JPEG を受け入れる', async () => {
    expect(validateImage(await checkerJpeg(64, 64))).toEqual({ ok: true, mediaType: 'image/jpeg' });
  });

  it('PNG を受け入れる', async () => {
    expect(validateImage(await flatPng(8, 8, 100))).toEqual({ ok: true, mediaType: 'image/png' });
  });

  it('画像でないデータ・空データ・GIF を拒否する', () => {
    expect(validateImage(Buffer.from('hello world'))).toEqual({ ok: false });
    expect(validateImage(Buffer.alloc(0))).toEqual({ ok: false });
    expect(validateImage(Buffer.from('GIF89a......'))).toEqual({ ok: false });
  });
});
```

`apps/api/src/image/prepare-image.test.ts`:

```ts
import sharp from 'sharp';

import { checkerJpeg } from '../test-utils';
import { MODEL_MAX_SIDE, prepareForModel } from './prepare-image';

describe('prepareForModel', () => {
  it('長辺を 1568px に縮小し JPEG にする', async () => {
    const out = await prepareForModel(await checkerJpeg(3000, 2000));
    expect(out.mediaType).toBe('image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(MODEL_MAX_SIDE);
    expect(meta.format).toBe('jpeg');
  });

  it('小さい画像は拡大しない', async () => {
    const out = await prepareForModel(await checkerJpeg(400, 300));
    const meta = await sharp(out.data).metadata();
    expect(meta.width).toBe(400);
  });
});
```

- [ ] **Step 3: 失敗を確認** — Run: `npm test -w api` → FAIL

- [ ] **Step 4: 実装**

`apps/api/src/image/validate-image.ts`:

```ts
export type ImageValidation = { ok: true; mediaType: 'image/jpeg' | 'image/png' } | { ok: false };

/** 宣言された Content-Type ではなく、先頭バイトで形式を判定する。 */
export function validateImage(data: Uint8Array): ImageValidation {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ok: true, mediaType: 'image/jpeg' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((b, i) => data[i] === b)) {
    return { ok: true, mediaType: 'image/png' };
  }
  return { ok: false };
}
```

`apps/api/src/image/prepare-image.ts`:

```ts
import sharp from 'sharp';

import type { DetectorImage } from '@coordinate/shared';

/** Claude に渡す画像の長辺(px)。これ以上は内部で縮小されるだけで、遅くなる。 */
export const MODEL_MAX_SIDE = 1568;

/** 向きを反映し、長辺を縮小して JPEG にする。画像はメモリ上のみで扱い、保存しない。 */
export async function prepareForModel(data: Uint8Array): Promise<DetectorImage> {
  const out = await sharp(data)
    .rotate()
    .resize({ width: MODEL_MAX_SIDE, height: MODEL_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: out, mediaType: 'image/jpeg' };
}
```

- [ ] **Step 5: 通過を確認**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add apps/api
git commit -m "feat(api): 画像の形式判定とモデル用の縮小を追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 写真品質の評価(sharp)

しきい値は初期値。Task 13 で実写真に当てて調整する(定数にまとめ、テストは定数を参照しない形にしない=値の意味が変わったらテストも見直す)。

**Files:**
- Create: `apps/api/src/image/quality.ts`, `apps/api/src/image/quality.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/src/image/quality.test.ts`:

```ts
import { checkerJpeg, flatJpeg } from '../test-utils';
import { assessQuality } from './quality';

describe('assessQuality', () => {
  it('十分な解像度・明るさ・シャープさなら問題なし', async () => {
    const r = await assessQuality(await checkerJpeg(1000, 1000));
    expect(r.issues).toEqual([]);
    expect(r.width).toBe(1000);
    expect(r.height).toBe(1000);
  });

  it('短辺が小さいと low_resolution', async () => {
    const r = await assessQuality(await checkerJpeg(300, 300));
    expect(r.issues).toContain('low_resolution');
  });

  it('暗い画像は too_dark', async () => {
    const r = await assessQuality(await flatJpeg(1000, 1000, 15));
    expect(r.issues).toContain('too_dark');
  });

  it('のっぺりした画像は blurry', async () => {
    const r = await assessQuality(await flatJpeg(1000, 1000, 128));
    expect(r.issues).toContain('blurry');
    expect(r.issues).not.toContain('too_dark');
  });

  it('壊れた画像は例外を投げる', async () => {
    await expect(assessQuality(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w api` → FAIL

- [ ] **Step 3: 実装**

`apps/api/src/image/quality.ts`:

```ts
import sharp from 'sharp';

import type { QualityIssue } from '@coordinate/shared';

/** 初期値。実写真で調整する(docs/phase3-model-comparison.md に結果を残す)。 */
export const THRESHOLDS = {
  /** 短辺がこれ未満なら解像度不足(px)。 */
  minShortSide: 720,
  /** 平均輝度(0〜255)がこれ未満なら暗すぎる。 */
  minMeanLuma: 60,
  /** ラプラシアン応答の標準偏差がこれ未満ならぶれ/ピンぼけ。 */
  minLaplacianStdev: 8,
} as const;

const ANALYSIS_SIDE = 512;

export type QualityAssessment = { issues: QualityIssue[]; width: number; height: number };

/** 解像度・明るさ・ぶれを評価する。全身が写っているかは検出結果から別に判定する。 */
export async function assessQuality(data: Uint8Array): Promise<QualityAssessment> {
  const meta = await sharp(data).rotate().metadata();
  // rotate() は EXIF の向きを反映する。メタデータの幅・高さは回転前なので、向きに応じて入れ替える。
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  if (width === 0 || height === 0) throw new Error('画像サイズを取得できません');

  const { data: gray, info } = await sharp(data)
    .rotate()
    .resize({ width: ANALYSIS_SIDE, height: ANALYSIS_SIDE, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: info.width, height: info.height, channels: 1 as const } };

  const mean = (await sharp(gray, raw).stats()).channels[0]?.mean ?? 0;
  // 負の応答を残すため offset=128 を足す。標準偏差は offset の影響を受けない。
  const lap = await sharp(gray, raw)
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .stats();
  const stdev = lap.channels[0]?.stdev ?? 0;

  const issues: QualityIssue[] = [];
  if (Math.min(width, height) < THRESHOLDS.minShortSide) issues.push('low_resolution');
  if (mean < THRESHOLDS.minMeanLuma) issues.push('too_dark');
  if (stdev < THRESHOLDS.minLaplacianStdev) issues.push('blurry');
  return { issues, width, height };
}
```

- [ ] **Step 4: 通過を確認**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS。「壊れた画像」が例外にならない場合は、`sharp(...).metadata()` が先頭バイトだけで成功していないか確認し、`.raw().toBuffer()` で失敗することをテストの根拠にする(例外が出る側の挙動に実装を合わせる)。

- [ ] **Step 5: コミット**

```bash
git add apps/api
git commit -m "feat(api): 解像度・明るさ・ぶれの品質評価を追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ClaudeVisionDetector(構造化出力・検証・ブランド根拠)

**Files:**
- Create: `apps/api/src/detector/schema.ts`, `prompt.ts`, `normalize.ts`, `normalize.test.ts`
- Create: `apps/api/src/detector/claude-vision-detector.ts`, `claude-vision-detector.test.ts`

- [ ] **Step 1: 出力スキーマとプロンプトを書く**

`apps/api/src/detector/schema.ts`:

```ts
import { z } from 'zod';

import { DEFAULT_CATEGORIES } from '@coordinate/shared';

/** Claude の出力(snake_case)。構造化出力に渡す JSON Schema と、受け取った後の zod 検証を揃える。 */
export const RawItemSchema = z.object({
  category_id: z.string(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  colors: z.array(z.string()),
  visible_text: z.array(z.string()),
  brand: z.string().nullable(),
  brand_confidence: z.number(),
  detection_confidence: z.number(),
  category_confidence: z.number(),
  notes: z.string().nullable(),
});
export type RawItem = z.infer<typeof RawItemSchema>;

export const RawOutputSchema = z.object({
  full_body: z.boolean(),
  items: z.array(RawItemSchema),
});
export type RawOutput = z.infer<typeof RawOutputSchema>;

const num = { type: 'number' } as const;
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

/** 構造化出力用。数値の範囲などの制約は書かず、受信後に zod / normalize で検証する。 */
export const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['full_body', 'items'],
  properties: {
    full_body: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category_id',
          'box',
          'colors',
          'visible_text',
          'brand',
          'brand_confidence',
          'detection_confidence',
          'category_confidence',
          'notes',
        ],
        properties: {
          category_id: { type: 'string', enum: DEFAULT_CATEGORIES.map((c) => c.id) },
          box: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y', 'w', 'h'],
            properties: { x: num, y: num, w: num, h: num },
          },
          colors: { type: 'array', items: { type: 'string' } },
          visible_text: { type: 'array', items: { type: 'string' } },
          brand: nullableString,
          brand_confidence: num,
          detection_confidence: num,
          category_confidence: num,
          notes: nullableString,
        },
      },
    },
  },
} as const;
```

`apps/api/src/detector/prompt.ts`:

```ts
import { DEFAULT_CATEGORIES } from '@coordinate/shared';

const CATEGORY_LIST = DEFAULT_CATEGORIES.map((c) => `${c.id} (${c.labelJa})`).join(', ');

/** ブランドは「読めた文字」だけを根拠にする。推測させない。 */
export const SYSTEM_PROMPT = `You analyze one outfit photo and list the wearable items visible on the person.

Rules:
- List only items that are clearly visible. Do not guess items that are hidden or cropped out.
- category_id must be one of: ${CATEGORY_LIST}. Use the "*_other" id when no specific category fits.
- box is the tight bounding box of the item as fractions of the whole image: x,y = top-left corner, w,h = size. All values are between 0 and 1, and x+w and y+h do not exceed 1.
- visible_text: transcribe text or logo wording that is actually legible on the item (printed on a shirt, on the side of a shoe, on a bag). Use an empty array when nothing is legible. Never invent text.
- brand: set a brand name only when it is legible in the photo and you copied the same wording into visible_text. Otherwise null. Never infer a brand from style, shape, silhouette, or typical association.
- brand_confidence: 0 to 1, how sure you are about the brand reading. 0 when brand is null.
- detection_confidence: 0 to 1, how sure you are that the item exists. category_confidence: 0 to 1, how sure you are about category_id.
- colors: main colors in Japanese (for example 白, 黒, ネイビー).
- notes: one short Japanese sentence about color, material or pattern, or null.
- full_body: true only when the person is visible from head to feet.`;

export const USER_PROMPT = 'List the wearable items in this photo.';
```

- [ ] **Step 2: normalize の失敗するテストを書く**

`apps/api/src/detector/normalize.test.ts`:

```ts
import type { RawItem, RawOutput } from './schema';
import { normalizeDetection } from './normalize';

const raw = (over: Partial<RawItem> = {}): RawItem => ({
  category_id: 'tshirt',
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
  colors: ['白'],
  visible_text: [],
  brand: null,
  brand_confidence: 0,
  detection_confidence: 0.9,
  category_confidence: 0.8,
  notes: null,
  ...over,
});
const out = (items: RawItem[]): RawOutput => ({ full_body: true, items });

describe('normalizeDetection', () => {
  it('正常な項目を DetectedItem に変換する(商品候補は空・ブランド無しは unidentified)', () => {
    const { items, dropped } = normalizeDetection(out([raw()]), 'm1');
    expect(dropped).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'item_1',
      categoryId: 'tshirt',
      candidates: [],
      level: 'unidentified',
      reviewState: 'auto',
      modelVersion: 'm1',
      brandCandidates: [],
    });
    expect(items[0]?.confidence).toMatchObject({ detection: 0.9, category: 0.8, brand: null, price: null });
  });

  it('不明なカテゴリ id は破棄する', () => {
    const { items, dropped } = normalizeDetection(out([raw({ category_id: 'spaceship' })]), 'm');
    expect(items).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('範囲外・はみ出す座標は破棄する', () => {
    const bad = [
      raw({ box: { x: -0.1, y: 0.1, w: 0.2, h: 0.2 } }),
      raw({ box: { x: 0.1, y: 0.1, w: 0, h: 0.2 } }),
      raw({ box: { x: 0.8, y: 0.1, w: 0.4, h: 0.2 } }),
    ];
    const { items, dropped } = normalizeDetection(out(bad), 'm');
    expect(items).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('信頼度が範囲外なら破棄する', () => {
    const { dropped } = normalizeDetection(out([raw({ detection_confidence: 1.5 })]), 'm');
    expect(dropped).toBe(1);
  });

  it('写真内の文字に根拠があるブランドだけ採用する(medium)', () => {
    const ok = raw({ brand: 'NIKE', visible_text: ['nike', 'JUST DO IT'], brand_confidence: 0.8 });
    const { items } = normalizeDetection(out([ok]), 'm');
    expect(items[0]).toMatchObject({ level: 'medium' });
    expect(items[0]?.brandCandidates).toEqual([{ name: 'NIKE', score: 0.8 }]);
    expect(items[0]?.confidence.brand).toBe(0.8);
    expect(items[0]?.rationale).toContain('nike');
  });

  it('文字の根拠が無いブランドは捨て、項目自体は残す(unidentified)', () => {
    const guess = raw({ brand: 'GUCCI', visible_text: [], brand_confidence: 0.9 });
    const { items } = normalizeDetection(out([guess]), 'm');
    expect(items).toHaveLength(1);
    expect(items[0]?.level).toBe('unidentified');
    expect(items[0]?.brandCandidates).toEqual([]);
    expect(items[0]?.confidence.brand).toBeNull();
  });

  it('全角・大文字小文字・記号の違いは同じ文字とみなす', () => {
    const r = raw({ brand: 'New Balance', visible_text: ['ＮＥＷ-ＢＡＬＡＮＣＥ'] });
    expect(normalizeDetection(out([r]), 'm').items[0]?.level).toBe('medium');
  });

  it('1 文字だけの読み取りは根拠にしない', () => {
    const r = raw({ brand: 'N', visible_text: ['N'] });
    expect(normalizeDetection(out([r]), 'm').items[0]?.level).toBe('unidentified');
  });

  it('ID は採用した項目に連番で振る', () => {
    const { items } = normalizeDetection(out([raw({ category_id: 'x' }), raw(), raw()]), 'm');
    expect(items.map((i) => i.id)).toEqual(['item_1', 'item_2']);
  });
});
```

- [ ] **Step 3: 失敗を確認** — Run: `npm test -w api` → FAIL(`./normalize` が無い)

- [ ] **Step 4: normalize を実装**

`apps/api/src/detector/normalize.ts`:

```ts
import { BoxSchema, DEFAULT_CATEGORIES, type DetectedItem } from '@coordinate/shared';

import type { RawItem, RawOutput } from './schema';

const CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
const EPS = 1e-6;

const unit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s\-_.'’・]/g, '');
}

/** ブランドと一致する、写真内の読み取り文字を返す。1 文字だけの一致は根拠にしない。 */
function findEvidence(brand: string, visibleText: string[]): string | null {
  const b = norm(brand);
  if (b.length < 2) return null;
  for (const t of visibleText) {
    const n = norm(t);
    if (n.length < 2) continue;
    if (n.includes(b) || b.includes(n)) return t;
  }
  return null;
}

function toItem(r: RawItem, id: string, model: string): DetectedItem | null {
  if (!CATEGORY_IDS.has(r.category_id)) return null;
  if (!BoxSchema.safeParse(r.box).success) return null;
  if (r.box.x + r.box.w > 1 + EPS || r.box.y + r.box.h > 1 + EPS) return null;
  if (!unit(r.detection_confidence) || !unit(r.category_confidence)) return null;

  const brandText = r.brand?.trim() ?? '';
  const evidence = brandText ? findEvidence(brandText, r.visible_text) : null;
  const brandScore = unit(r.brand_confidence) ? r.brand_confidence : 0;
  const hasBrand = evidence !== null;

  return {
    id,
    categoryId: r.category_id,
    box: {
      x: r.box.x,
      y: r.box.y,
      w: Math.min(r.box.w, 1 - r.box.x),
      h: Math.min(r.box.h, 1 - r.box.y),
    },
    appearance: {
      colors: r.colors,
      visibleText: r.visible_text,
      ...(r.notes ? { notes: r.notes } : {}),
    },
    brandCandidates: hasBrand ? [{ name: brandText, score: brandScore }] : [],
    candidates: [],
    confidence: {
      detection: r.detection_confidence,
      category: r.category_confidence,
      brand: hasBrand ? brandScore : null,
      model: null,
      variant: null,
      price: null,
    },
    // 商品として確認できていないため high は使わない(Phase 4 で商品照合できた場合のみ)。
    level: hasBrand ? 'medium' : 'unidentified',
    reviewState: 'auto',
    rationale: hasBrand
      ? `写真内の文字「${evidence}」からブランド名を読み取りました`
      : 'ブランドを示す文字・ロゴが確認できませんでした',
    modelVersion: model,
  };
}

/** Claude の出力を検証し、不正な項目は破棄する。破棄した数は成功として数えない。 */
export function normalizeDetection(
  output: RawOutput,
  model: string,
): { items: DetectedItem[]; dropped: number } {
  const items: DetectedItem[] = [];
  let dropped = 0;
  for (const r of output.items) {
    const item = toItem(r, `item_${items.length + 1}`, model);
    if (item) items.push(item);
    else dropped += 1;
  }
  return { items, dropped };
}
```

- [ ] **Step 5: normalize の通過を確認** — Run: `npm test -w api` → normalize 9 件 PASS

- [ ] **Step 6: 検出器の失敗するテストを書く**

`apps/api/src/detector/claude-vision-detector.test.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';

import { ClaudeVisionDetector, DetectionError } from './claude-vision-detector';

const image = { data: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mediaType: 'image/jpeg' as const };

const goodJson = {
  full_body: true,
  items: [
    {
      category_id: 'sneakers',
      box: { x: 0.4, y: 0.8, w: 0.2, h: 0.15 },
      colors: ['白'],
      visible_text: ['NIKE'],
      brand: 'NIKE',
      brand_confidence: 0.7,
      detection_confidence: 0.9,
      category_confidence: 0.9,
      notes: null,
    },
    {
      category_id: 'spaceship',
      box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      colors: [],
      visible_text: [],
      brand: null,
      brand_confidence: 0,
      detection_confidence: 0.9,
      category_confidence: 0.9,
      notes: null,
    },
  ],
};

function client(response: Partial<Anthropic.Message>) {
  const create = jest.fn().mockResolvedValue({
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1500, output_tokens: 420 },
    content: [{ type: 'text', text: JSON.stringify(goodJson) }],
    ...response,
  });
  return { create, api: { messages: { create } } };
}

describe('ClaudeVisionDetector', () => {
  it('検出結果を検証して返し、トークン数とモデル名を記録する', async () => {
    const c = client({});
    const r = await new ClaudeVisionDetector(c.api, 'claude-sonnet-5-5', 'medium').detect(image);
    expect(r.items).toHaveLength(1); // 不正なカテゴリは破棄
    expect(r.items[0]).toMatchObject({ categoryId: 'sneakers', level: 'medium' });
    expect(r.fullBody).toBe(true);
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.usage).toEqual({ inputTokens: 1500, outputTokens: 420 });
  });

  it('構造化出力・effort・画像を指定して呼び出す(tool_choice は強制しない)', async () => {
    const c = client({});
    await new ClaudeVisionDetector(c.api, 'claude-haiku-5-5', 'low').detect(image);
    const params = c.create.mock.calls[0]?.[0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.tool_choice).toBeUndefined();
    const content = params.messages[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
  });

  it('refusal は DetectionError(refusal)', async () => {
    const c = client({ stop_reason: 'refusal', content: [] });
    await expect(new ClaudeVisionDetector(c.api, 'm', 'medium').detect(image)).rejects.toMatchObject({
      code: 'refusal',
    });
  });

  it('max_tokens で打ち切られたら DetectionError(truncated)', async () => {
    const c = client({ stop_reason: 'max_tokens' });
    await expect(new ClaudeVisionDetector(c.api, 'm', 'medium').detect(image)).rejects.toMatchObject({
      code: 'truncated',
    });
  });

  it('JSON でない・スキーマに合わない出力は DetectionError(invalid_output)', async () => {
    for (const text of ['not json', JSON.stringify({ items: 'x' })]) {
      const c = client({ content: [{ type: 'text', text }] as Anthropic.Message['content'] });
      const p = new ClaudeVisionDetector(c.api, 'm', 'medium').detect(image);
      await expect(p).rejects.toBeInstanceOf(DetectionError);
      await expect(p).rejects.toMatchObject({ code: 'invalid_output' });
    }
  });

  it('SDK の例外はそのまま伝える', async () => {
    const create = jest.fn().mockRejectedValue(new Error('network'));
    const d = new ClaudeVisionDetector({ messages: { create } }, 'm', 'medium');
    await expect(d.detect(image)).rejects.toThrow('network');
  });
});
```

- [ ] **Step 7: 失敗を確認** — Run: `npm test -w api` → FAIL

- [ ] **Step 8: 検出器を実装**

`apps/api/src/detector/claude-vision-detector.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';

import type { Detector, DetectorImage, DetectorResult } from '@coordinate/shared';

import type { Effort } from '../config';
import { normalizeDetection } from './normalize';
import { SYSTEM_PROMPT, USER_PROMPT } from './prompt';
import { OUTPUT_JSON_SCHEMA, RawOutputSchema } from './schema';

/** テストで差し替えられるよう、必要な部分だけを型にする。 */
export type MessagesClient = {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
};

export type DetectionErrorCode = 'refusal' | 'truncated' | 'invalid_output';

export class DetectionError extends Error {
  constructor(
    readonly code: DetectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DetectionError';
  }
}

export class ClaudeVisionDetector implements Detector {
  constructor(
    private readonly client: MessagesClient,
    private readonly model: string,
    private readonly effort: Effort,
  ) {}

  async detect(image: DetectorImage): Promise<DetectorResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      // Sonnet 5.5 は tool_choice の強制が使えないため、構造化出力で JSON を得る。
      output_config: { effort: this.effort, format: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType,
                data: Buffer.from(image.data).toString('base64'),
              },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    });

    if (res.stop_reason === 'refusal') throw new DetectionError('refusal', 'モデルが応答を拒否しました');
    if (res.stop_reason === 'max_tokens') throw new DetectionError('truncated', '出力が途中で打ち切られました');

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    let json: unknown;
    try {
      json = JSON.parse(text ?? '');
    } catch {
      throw new DetectionError('invalid_output', '出力が JSON ではありません');
    }
    const parsed = RawOutputSchema.safeParse(json);
    if (!parsed.success) throw new DetectionError('invalid_output', '出力がスキーマに合いません');

    const { items } = normalizeDetection(parsed.data, res.model);
    return {
      items,
      fullBody: parsed.data.full_body,
      model: res.model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }
}
```

- [ ] **Step 9: 通過と型検査**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS。`output_config` に `effort` / `format` が無いという型エラーが出たら、`npm ls @anthropic-ai/sdk` で版を確認し `npm install -w api @anthropic-ai/sdk@latest` で更新する(更新しても出る場合は `shared/live-sources.md` の SDK リポジトリで `output_config` の型を確認し、実装を型に合わせる。**型エラーを `as any` で消さない**)。

- [ ] **Step 10: コミット**

```bash
git add apps/api package-lock.json
git commit -m "feat(api): Claude Vision による検出器と出力の検証を追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: /v1/analyze ルート・使用量の記録・サーバー起動

**Files:**
- Create: `apps/api/src/usage.ts`, `usage.test.ts`
- Create: `apps/api/src/routes/analyze.ts`, `analyze.test.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`

- [ ] **Step 1: 使用量の失敗するテストを書く**

`apps/api/src/usage.test.ts`:

```ts
import { estimateCostUsd } from './usage';

describe('estimateCostUsd', () => {
  it('単価が設定されていれば概算する', () => {
    const cost = estimateCostUsd(
      { inputTokens: 2_000_000, outputTokens: 500_000 },
      { inputPerMTok: 2, outputPerMTok: 10 },
    );
    expect(cost).toBeCloseTo(9);
  });

  it('単価が無ければ null', () => {
    expect(estimateCostUsd({ inputTokens: 1, outputTokens: 1 }, null)).toBeNull();
  });
});
```

- [ ] **Step 2: 実装**

`apps/api/src/usage.ts`:

```ts
import type { Usage } from '@coordinate/shared';

import type { Config } from './config';

/** 概算の USD。単価は設定値で、ソースに固定しない。未設定なら null。 */
export function estimateCostUsd(usage: Usage, pricing: Config['pricing']): number | null {
  if (!pricing) return null;
  return (usage.inputTokens * pricing.inputPerMTok + usage.outputTokens * pricing.outputPerMTok) / 1_000_000;
}
```

Run: `npm test -w api` → usage 2 件 PASS。

- [ ] **Step 3: ルートの失敗するテストを書く**

`apps/api/src/routes/analyze.test.ts`:

```ts
import { AnalyzeResponseSchema } from '@coordinate/shared';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { checkerJpeg, fakeDetector, multipartBody } from '../test-utils';

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
});
```

- [ ] **Step 4: 失敗を確認** — Run: `npm test -w api` → FAIL(ルートが無い)

- [ ] **Step 5: ルートを実装**

`apps/api/src/routes/analyze.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';

import { AnalyzeResponseSchema, type ApiErrorCode, type QualityIssue } from '@coordinate/shared';

import type { AppDeps } from '../app';
import { prepareForModel } from '../image/prepare-image';
import { assessQuality } from '../image/quality';
import { validateImage } from '../image/validate-image';
import { estimateCostUsd } from '../usage';

const MESSAGES: Record<ApiErrorCode, string> = {
  invalid_image: '画像を読み取れませんでした。JPEG または PNG の写真を選んでください。',
  too_large: '画像が大きすぎます。10MB 以下の写真を選んでください。',
  analysis_failed: '解析に失敗しました。時間をおいて、もう一度お試しください。',
  not_configured: '解析サーバーが設定されていません。',
  rate_limited: '短時間にリクエストが集中しています。少し待ってからお試しください。',
};

export function sendError(reply: FastifyReply, status: number, error: ApiErrorCode) {
  return reply.status(status).send({ error, message: MESSAGES[error] });
}

export const RATE_LIMIT_BODY = { error: 'rate_limited' as const, message: MESSAGES.rate_limited };

export function registerAnalyzeRoute(app: FastifyInstance, deps: AppDeps) {
  app.post('/v1/analyze', { config: { rateLimit: {} } }, async (req, reply) => {
    const t0 = performance.now();

    let file;
    try {
      file = await req.file();
    } catch {
      return sendError(reply, 400, 'invalid_image');
    }
    if (!file) return sendError(reply, 400, 'invalid_image');

    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'FST_REQ_FILE_TOO_LARGE'
        ? sendError(reply, 400, 'too_large')
        : sendError(reply, 400, 'invalid_image');
    }
    if (file.file.truncated) return sendError(reply, 400, 'too_large');

    // 画像検証は他の処理より前に行う。
    if (!validateImage(data).ok) return sendError(reply, 400, 'invalid_image');
    if (!deps.detector) return sendError(reply, 503, 'not_configured');

    let quality;
    let prepared;
    const tq = performance.now();
    try {
      quality = await assessQuality(data);
      prepared = await prepareForModel(data);
    } catch {
      return sendError(reply, 400, 'invalid_image');
    }
    const qualityMs = performance.now() - tq;

    const td = performance.now();
    let result;
    try {
      result = await deps.detector.detect(prepared);
    } catch (e) {
      // 画像・キー・上流の詳細はログに残さない。種類だけ記録する。
      req.log.error({ errorName: (e as Error).name, status: (e as { status?: number }).status }, 'detect failed');
      return sendError(reply, 502, 'analysis_failed');
    }
    const detectMs = performance.now() - td;

    const issues: QualityIssue[] = [...quality.issues];
    if (!result.fullBody) issues.push('not_full_body');

    req.log.info(
      {
        usage: {
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          detectMs: Math.round(detectMs),
          estimatedCostUsd: estimateCostUsd(result.usage, deps.config.pricing),
        },
        items: result.items.length,
      },
      'analyzed',
    );

    const body = AnalyzeResponseSchema.parse({
      quality: { ok: issues.length === 0, issues },
      items: result.items,
      model: result.model,
      usage: result.usage,
      timings: {
        quality: Math.round(qualityMs),
        detect: Math.round(detectMs),
        total: Math.round(performance.now() - t0),
      },
    });
    return reply.send(body);
  });
}
```

`apps/api/src/app.ts` を次の内容に置き換える:

```ts
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Detector } from '@coordinate/shared';

import type { Config } from './config';
import { RATE_LIMIT_BODY, registerAnalyzeRoute } from './routes/analyze';

export type AppDeps = {
  config: Config;
  /** null ならキー未設定。解析は 503 を返す。 */
  detector: Detector | null;
  logger?: boolean;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.register(multipart, { limits: { fileSize: deps.config.maxImageBytes, files: 1 } });
  app.register(rateLimit, {
    global: false,
    max: deps.config.ratePerMinute,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, ...RATE_LIMIT_BODY }),
  });

  app.get('/health', async () => ({ ok: true, detectorConfigured: deps.detector !== null }));
  app.register(async (instance) => registerAnalyzeRoute(instance, deps));

  return app;
}
```

`apps/api/src/server.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';

import { buildApp } from './app';
import { loadConfig } from './config';
import { ClaudeVisionDetector } from './detector/claude-vision-detector';

const config = loadConfig();
const detector = config.anthropicApiKey
  ? new ClaudeVisionDetector(
      new Anthropic({ apiKey: config.anthropicApiKey, timeout: 60_000, maxRetries: 1 }),
      config.model,
      config.effort,
    )
  : null;

const app = buildApp({ config, detector, logger: true });
if (!detector) app.log.warn('ANTHROPIC_API_KEY が未設定です。/v1/analyze は 503 を返します。');

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: 通過と型検査**

Run: `npm test -w api && npm run typecheck -w api`
Expected: PASS(api 全件)。`file.file.truncated` や `req.file()` の型が合わない場合は `@fastify/multipart` の README の型に合わせる(`as any` で消さない)。429 のテストが 200 のままなら、`config: { rateLimit: {} }` が route に効いているか(global:false で route ごとの設定を拾うか)を確認する。

- [ ] **Step 7: 起動の確認(キー無しでも動くこと)**

Run: `cd apps/api && (timeout 8 npx tsx src/server.ts & sleep 4; curl -s localhost:8787/health; wait)`
Expected: `{"ok":true,"detectorConfigured":false}` と警告ログ(`.env` が無くても落ちない。`--env-file` を付けないため)

- [ ] **Step 8: コミット**

```bash
git add apps/api
git commit -m "feat(api): /v1/analyze を追加(品質評価・検出・使用量のログ・エラー応答)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: アプリの API クライアント

**Files:**
- Create: `apps/mobile/src/lib/analyze-api.ts`
- Create: `apps/mobile/__tests__/analyze-api.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`apps/mobile/__tests__/analyze-api.test.ts`:

```ts
import { AnalyzeError, analyzePhoto, ERROR_MESSAGES } from '@/lib/analyze-api';

const okBody = {
  quality: { ok: true, issues: [] },
  items: [],
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 10, outputTokens: 5 },
  timings: { quality: 10, detect: 20, total: 31 },
};

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const opts = (fetchImpl: jest.Mock) => ({ baseUrl: 'http://api.test', fetchImpl: fetchImpl as unknown as typeof fetch });

describe('analyzePhoto', () => {
  it('成功時はスキーマ検証したレスポンスを返し、/v1/analyze へ POST する', async () => {
    const f = jest.fn().mockResolvedValue(json(200, okBody));
    const res = await analyzePhoto('file:///a.jpg', opts(f));
    expect(res.model).toBe('claude-sonnet-5-5');
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/v1/analyze');
    expect(f.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it.each([
    [400, 'invalid_image'],
    [400, 'too_large'],
    [503, 'not_configured'],
    [429, 'rate_limited'],
    [502, 'analysis_failed'],
  ])('HTTP %i / %s を AnalyzeError に変換する', async (status, error) => {
    const f = jest.fn().mockResolvedValue(json(status, { error, message: 'x' }));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: error });
  });

  it('本文が不明な失敗は analysis_failed', async () => {
    const f = jest.fn().mockResolvedValue(json(500, { oops: true }));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: 'analysis_failed' });
  });

  it('スキーマに合わない成功レスポンスは analysis_failed(成功として扱わない)', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { items: 'x' }));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: 'analysis_failed' });
  });

  it('通信できなければ network', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(analyzePhoto('file:///a.jpg', opts(f))).rejects.toMatchObject({ kind: 'network' });
  });

  it('API の URL が未設定なら not_configured', async () => {
    const prev = process.env.EXPO_PUBLIC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    await expect(analyzePhoto('file:///a.jpg', { fetchImpl: jest.fn() as unknown as typeof fetch })).rejects.toMatchObject({
      kind: 'not_configured',
    });
    if (prev !== undefined) process.env.EXPO_PUBLIC_API_BASE_URL = prev;
  });

  it('全種類のエラーに利用者向けの文言がある(開発者向けの文言を出さない)', () => {
    for (const msg of Object.values(ERROR_MESSAGES)) {
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/ANTHROPIC|\.env|API_KEY/);
    }
    expect(new AnalyzeError('network').kind).toBe('network');
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w mobile -- analyze-api` → FAIL

- [ ] **Step 3: 実装**

`apps/mobile/src/lib/analyze-api.ts`:

```ts
import { AnalyzeResponseSchema, ApiErrorSchema, type AnalyzeResponse, type ApiErrorCode } from '@coordinate/shared';

export type AnalyzeErrorKind = ApiErrorCode | 'network';

export class AnalyzeError extends Error {
  constructor(readonly kind: AnalyzeErrorKind) {
    super(kind);
    this.name = 'AnalyzeError';
  }
}

/** 利用者に見せる文言。開発者向けの情報(環境変数名など)は出さない。 */
export const ERROR_MESSAGES: Record<AnalyzeErrorKind, string> = {
  invalid_image: '写真を読み取れませんでした。別の写真を選んでください。',
  too_large: '写真が大きすぎます。別の写真を選んでください。',
  analysis_failed: '解析に失敗しました。もう一度お試しください。',
  not_configured: '解析サーバーが未設定です。',
  rate_limited: '短時間にリクエストが集中しています。少し待ってからお試しください。',
  network: '通信できませんでした。ネットワークを確認して、もう一度お試しください。',
};

type Options = { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

/** 写真 1 枚を解析 API へ送る。検出結果は zod で検証し、合わなければ失敗として扱う。 */
export async function analyzePhoto(uri: string, options: Options = {}): Promise<AnalyzeResponse> {
  const baseUrl = options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new AnalyzeError('not_configured');
  const doFetch = options.fetchImpl ?? fetch;

  const form = new FormData();
  // React Native の FormData はファイル URI をそのまま添付できる。
  form.append('image', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl.replace(/\/$/, '')}/v1/analyze`, {
      method: 'POST',
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
    throw new AnalyzeError('analysis_failed');
  }

  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(body);
    throw new AnalyzeError(err.success ? err.data.error : 'analysis_failed');
  }
  const parsed = AnalyzeResponseSchema.safeParse(body);
  if (!parsed.success) throw new AnalyzeError('analysis_failed');
  return parsed.data;
}
```

- [ ] **Step 4: 通過を確認**

Run: `npm test -w mobile -- analyze-api && npm run typecheck -w mobile`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add apps/mobile
git commit -m "feat(mobile): 解析 API クライアントを追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 解析結果の状態管理(reducer と context)

**Files:**
- Create: `apps/mobile/src/features/analysis/analysis-reducer.ts`
- Create: `apps/mobile/src/features/analysis/analysis-context.tsx`
- Create: `apps/mobile/__tests__/analysis-reducer.test.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`

- [ ] **Step 1: 失敗するテストを書く**

`apps/mobile/__tests__/analysis-reducer.test.ts`:

```ts
import type { AnalyzeResponse, DetectedItem } from '@coordinate/shared';

import {
  analysisReducer,
  initialAnalysisState,
  type AnalysisAction,
  type AnalysisState,
} from '@/features/analysis/analysis-reducer';

const det = (id: string, over: Partial<DetectedItem> = {}): DetectedItem => ({
  id,
  categoryId: 'tshirt',
  box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
  appearance: { colors: [], visibleText: [] },
  brandCandidates: [],
  candidates: [],
  confidence: { detection: 0.9, category: 0.9, brand: null, model: null, variant: null, price: null },
  level: 'unidentified',
  reviewState: 'auto',
  rationale: '',
  modelVersion: 'm',
  ...over,
});

const response = (items: DetectedItem[]): AnalyzeResponse => ({
  quality: { ok: false, issues: ['blurry'] },
  items,
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1, outputTokens: 1 },
  timings: { quality: 10, detect: 20, total: 31 },
});

const run = (actions: AnalysisAction[], from: AnalysisState = initialAnalysisState) =>
  actions.reduce(analysisReducer, from);

const done = (items: DetectedItem[]) => run([{ type: 'start' }, { type: 'succeeded', response: response(items) }]);

describe('analysisReducer', () => {
  it('start で loading、失敗で kind を保持する', () => {
    expect(run([{ type: 'start' }]).status).toBe('loading');
    expect(run([{ type: 'start' }, { type: 'failed', kind: 'network' }])).toEqual({ status: 'failed', kind: 'network' });
  });

  it('成功すると検出結果を編集用の項目に変換する(ブランドは候補の先頭、無ければ空)', () => {
    const s = done([
      det('a', { brandCandidates: [{ name: 'NIKE', score: 0.8 }], level: 'medium' }),
      det('b'),
    ]);
    if (s.status !== 'done') throw new Error('done ではありません');
    expect(s.items.map((i) => [i.id, i.brand, i.origin, i.level])).toEqual([
      ['a', 'NIKE', 'ai', 'medium'],
      ['b', '', 'ai', 'unidentified'],
    ]);
    expect(s.quality.issues).toEqual(['blurry']);
    expect(s.applied).toBe(false);
  });

  it('カテゴリ変更・ブランド入力・削除ができる', () => {
    let s = done([det('a'), det('b')]);
    s = run([{ type: 'setCategory', id: 'a', categoryId: 'knit' }, { type: 'setBrand', id: 'a', brand: 'UNIQLO' }, { type: 'remove', id: 'b' }], s);
    if (s.status !== 'done') throw new Error();
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ id: 'a', categoryId: 'knit', brand: 'UNIQLO' });
  });

  it('手動追加は origin=manual で、unidentified になる', () => {
    let s = done([]);
    s = run([{ type: 'addManual', id: 'm1', categoryId: 'sneakers' }], s);
    if (s.status !== 'done') throw new Error();
    expect(s.items[0]).toMatchObject({ id: 'm1', origin: 'manual', categoryId: 'sneakers', brand: '', level: 'unidentified' });
  });

  it('done 以外での編集操作は無視する', () => {
    const s = run([{ type: 'remove', id: 'a' }]);
    expect(s).toBe(initialAnalysisState);
  });

  it('applied を立てられ、reset で初期状態に戻る', () => {
    let s = done([det('a')]);
    s = run([{ type: 'applied' }], s);
    if (s.status !== 'done') throw new Error();
    expect(s.applied).toBe(true);
    expect(run([{ type: 'reset' }], s)).toBe(initialAnalysisState);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w mobile -- analysis-reducer` → FAIL

- [ ] **Step 3: reducer を実装**

`apps/mobile/src/features/analysis/analysis-reducer.ts`:

```ts
import type { AnalyzeResponse, Box, IdentificationLevel, Quality } from '@coordinate/shared';

import type { AnalyzeErrorKind } from '@/lib/analyze-api';

/** 認識結果画面で編集する 1 件。Phase 3 では商品・価格は持たない。 */
export type ResultItem = {
  id: string;
  categoryId: string;
  /** 空文字ならブランド不明。 */
  brand: string;
  /** 写真全体に対する正規化座標。 */
  box: Box;
  origin: 'ai' | 'manual';
  level: IdentificationLevel;
};

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; kind: AnalyzeErrorKind }
  | {
      status: 'done';
      items: ResultItem[];
      quality: Quality;
      timings: AnalyzeResponse['timings'];
      model: string;
      /** 編集画面へラベルを渡し済みか(二重に追加しない)。 */
      applied: boolean;
    };

export const initialAnalysisState: AnalysisState = { status: 'idle' };

export type AnalysisAction =
  | { type: 'start' }
  | { type: 'succeeded'; response: AnalyzeResponse }
  | { type: 'failed'; kind: AnalyzeErrorKind }
  | { type: 'setCategory'; id: string; categoryId: string }
  | { type: 'setBrand'; id: string; brand: string }
  | { type: 'remove'; id: string }
  | { type: 'addManual'; id: string; categoryId: string }
  | { type: 'applied' }
  | { type: 'reset' };

/** 手動追加した項目の初期枠(写真中央)。 */
export const MANUAL_BOX: Box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'start':
      return { status: 'loading' };
    case 'failed':
      return { status: 'failed', kind: action.kind };
    case 'reset':
      return initialAnalysisState;
    case 'succeeded':
      return {
        status: 'done',
        items: action.response.items.map((i) => ({
          id: i.id,
          categoryId: i.categoryId,
          brand: i.brandCandidates[0]?.name ?? '',
          box: i.box,
          origin: 'ai' as const,
          level: i.level,
        })),
        quality: action.response.quality,
        timings: action.response.timings,
        model: action.response.model,
        applied: false,
      };
  }

  if (state.status !== 'done') return state;
  switch (action.type) {
    case 'setCategory':
      return { ...state, items: state.items.map((i) => (i.id === action.id ? { ...i, categoryId: action.categoryId } : i)) };
    case 'setBrand':
      return { ...state, items: state.items.map((i) => (i.id === action.id ? { ...i, brand: action.brand } : i)) };
    case 'remove':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case 'addManual':
      return {
        ...state,
        items: [
          ...state.items,
          { id: action.id, categoryId: action.categoryId, brand: '', box: MANUAL_BOX, origin: 'manual', level: 'unidentified' },
        ],
      };
    case 'applied':
      return { ...state, applied: true };
  }
}
```

- [ ] **Step 4: context と _layout**

`apps/mobile/src/features/analysis/analysis-context.tsx`:

```tsx
import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';

import { analysisReducer, initialAnalysisState, type AnalysisAction, type AnalysisState } from './analysis-reducer';

type AnalysisContextValue = { state: AnalysisState; dispatch: Dispatch<AnalysisAction> };

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function AnalysisProvider({
  children,
  initialState = initialAnalysisState,
}: {
  children: ReactNode;
  /** テスト用。 */
  initialState?: AnalysisState;
}) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis(): AnalysisContextValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis は AnalysisProvider の内側で使用してください');
  return ctx;
}

/** 手動追加する項目の ID。 */
export function newItemId(): string {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
```

`apps/mobile/src/app/_layout.tsx` を変更する。import を追加:

```tsx
import { AnalysisProvider } from '@/features/analysis/analysis-context';
```

`<EditorProvider>` 〜 `</EditorProvider>` の内側を `AnalysisProvider` で包む(`ThemeProvider` ごと):

```tsx
      <EditorProvider>
        <AnalysisProvider>
          <ThemeProvider value={navTheme}>
            {/* 既存の StatusBar と Stack をそのまま移す */}
          </ThemeProvider>
        </AnalysisProvider>
      </EditorProvider>
```

(`{/* … */}` の部分は既存の `<StatusBar … />` と `<Stack>…</Stack>` に置き換える。中身は変更しない。)

- [ ] **Step 5: 通過を確認**

Run: `npm test -w mobile && npm run typecheck -w mobile && npm run lint -w mobile`
Expected: PASS(既存の screens テストも通る)

- [ ] **Step 6: コミット**

```bash
git add apps/mobile
git commit -m "feat(mobile): 解析結果の状態管理を追加" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: analyzing 画面とホームからの導線

**Files:**
- Modify: `apps/mobile/src/features/editor/editor-context.tsx`(テスト用 `initialState`)
- Modify: `apps/mobile/src/app/analyzing.tsx`, `apps/mobile/src/app/index.tsx`
- Modify: `apps/mobile/__tests__/screens.test.tsx`

- [ ] **Step 1: EditorProvider にテスト用の初期状態を追加**

`apps/mobile/src/features/editor/editor-context.tsx` の `EditorProvider` を変更:

```tsx
export function EditorProvider({
  children,
  initialState = initialEditorState,
}: {
  children: ReactNode;
  /** テスト用。 */
  initialState?: EditorState;
}) {
  const [state, dispatch] = useReducer(editorReducer, initialState);
```

(以降は既存のまま。)

- [ ] **Step 2: screens テストを更新(失敗するテストを先に書く)**

`apps/mobile/__tests__/screens.test.tsx` を次のとおり変更する。

import に追加:

```tsx
import { AnalysisProvider } from '@/features/analysis/analysis-context';
import { editorReducer, initialEditorState } from '@/features/editor/reducer';
import { AnalyzeError } from '@/lib/analyze-api';
```

(`EditorProvider` の import は既存のまま。)

モックと補助を `withProvider` の周辺に追加・変更:

```tsx
const mockAnalyzePhoto = jest.fn();
jest.mock('@/lib/analyze-api', () => {
  const actual = jest.requireActual('@/lib/analyze-api');
  return { ...actual, analyzePhoto: (...args: unknown[]) => mockAnalyzePhoto(...args) };
});

const withProvider = (ui: ReactElement) => (
  <EditorProvider>
    <AnalysisProvider>{ui}</AnalysisProvider>
  </EditorProvider>
);

const loadedEditor = editorReducer(initialEditorState, {
  type: 'loadPhoto',
  photo: { uri: 'file:///a.jpg', width: 3000, height: 4000 },
});
const withPhoto = (ui: ReactElement) => (
  <EditorProvider initialState={loadedEditor}>
    <AnalysisProvider>{ui}</AnalysisProvider>
  </EditorProvider>
);
```

ホームの describe を変更(1 つ目のテストから「準備中」の assertion を外し、遷移先を `/analyzing` に):

```tsx
describe('ホーム', () => {
  it('写真を選ぶボタンがあり、未実装の注意書きは出さない', () => {
    render(withProvider(<HomeScreen />));
    expect(screen.getByText(/1枚選ぶだけ/)).toBeTruthy();
    expect(screen.getByLabelText('写真を選ぶ')).toBeTruthy();
    expect(screen.queryByText(/未実装/)).toBeNull();
    expect(screen.queryByLabelText('編集を続ける')).toBeNull();
  });

  it('写真を選ぶと AI 解析画面へ遷移する', async () => {
    mockPickPhoto.mockResolvedValue({ uri: 'file:///a.jpg', width: 3000, height: 4000 });
    render(withProvider(<HomeScreen />));
    fireEvent.press(screen.getByLabelText('写真を選ぶ'));
    await screen.findByLabelText('編集を続ける');
    expect(mockPush).toHaveBeenCalledWith('/analyzing');
  });
  // 「選択をキャンセル」「読み込みに失敗」の既存テストはそのまま残す
});
```

「未実装の画面」の describe(analyzing / result の `it.each`)を削除し、次を追加:

```tsx
describe('AI解析画面', () => {
  const response = {
    quality: { ok: true, issues: [] },
    items: [],
    model: 'claude-sonnet-5-5',
    usage: { inputTokens: 1, outputTokens: 1 },
    timings: { quality: 5, detect: 10, total: 16 },
  };

  it('表示と同時に解析を始め、成功したら結果画面へ進む', async () => {
    mockAnalyzePhoto.mockResolvedValue(response);
    render(withPhoto(<AnalyzingScreen />));
    expect(screen.getByText('解析しています')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
    expect(mockAnalyzePhoto).toHaveBeenCalledWith('file:///a.jpg');
  });

  it('失敗したら利用者向けの文言と再試行・手動編集の導線を出す', async () => {
    mockAnalyzePhoto.mockRejectedValueOnce(new AnalyzeError('not_configured'));
    render(withPhoto(<AnalyzingScreen />));
    expect(await screen.findByText('解析サーバーが未設定です。')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    mockAnalyzePhoto.mockResolvedValueOnce(response);
    fireEvent.press(screen.getByLabelText('もう一度試す'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
  });

  it('解析せずに手動で編集へ進める', async () => {
    mockAnalyzePhoto.mockRejectedValue(new AnalyzeError('network'));
    render(withPhoto(<AnalyzingScreen />));
    await screen.findByLabelText('手動で編集する');
    fireEvent.press(screen.getByLabelText('手動で編集する'));
    expect(mockReplace).toHaveBeenCalledWith('/editor');
  });

  it('写真が無ければホームへ戻る導線を出す', () => {
    render(withProvider(<AnalyzingScreen />));
    expect(screen.getByText('解析する写真がありません。')).toBeTruthy();
    expect(mockAnalyzePhoto).not.toHaveBeenCalled();
  });
});
```

import の `@testing-library/react-native` に `waitFor` を追加する。

- [ ] **Step 3: 失敗を確認** — Run: `npm test -w mobile -- screens` → FAIL

- [ ] **Step 4: analyzing 画面を実装**

`apps/mobile/src/app/analyzing.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAnalysis } from '@/features/analysis/analysis-context';
import { useEditor } from '@/features/editor/editor-context';
import { AnalyzeError, analyzePhoto, ERROR_MESSAGES } from '@/lib/analyze-api';
import { useTheme } from '@/hooks/use-theme';

export default function AnalyzingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { snapshot } = useEditor();
  const { state, dispatch } = useAnalysis();
  const started = useRef(false);
  const uri = snapshot?.photo.uri;

  const run = useCallback(async () => {
    if (!uri) return;
    dispatch({ type: 'start' });
    try {
      const response = await analyzePhoto(uri);
      dispatch({ type: 'succeeded', response });
      router.replace('/result');
    } catch (e) {
      dispatch({ type: 'failed', kind: e instanceof AnalyzeError ? e.kind : 'analysis_failed' });
    }
  }, [uri, dispatch, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  if (!uri) {
    return (
      <Screen>
        <ThemedText>解析する写真がありません。</ThemedText>
        <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  if (state.status === 'failed') {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText type="subtitle">解析できませんでした</ThemedText>
          <ThemedText accessibilityRole="alert" themeColor="textSecondary">
            {ERROR_MESSAGES[state.kind]}
          </ThemedText>
        </View>
        <View style={styles.buttons}>
          <AppButton label="もう一度試す" onPress={() => void run()} />
          <AppButton label="手動で編集する" variant="secondary" onPress={() => router.replace('/editor')} />
          <AppButton label="ホームに戻る" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.center}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="subtitle">解析しています</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          写真を解析サーバーへ送り、写っているアイテムを検出しています。数秒かかります。
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { gap: Spacing.three, alignItems: 'center', paddingVertical: Spacing.five },
  buttons: { gap: Spacing.three },
});
```

- [ ] **Step 5: ホームを変更**

`apps/mobile/src/app/index.tsx`:
- `NotImplemented` の import と、`<NotImplemented phase={3} … />` の要素を削除する。
- `STEPS` の 2 行目を `['02', 'AIがアイテムを検出']` に、3 行目を `['03', '結果を確認・修正']` にする(商品候補は Phase 4 まで出さないため「商品候補を提示(準備中)」の文言は外す)。
- `useAnalysis` を import し、`const { dispatch: analysisDispatch } = useAnalysis();` を追加。
- `choose` 内を次のとおり変更:

```tsx
      if (photo) {
        analysisDispatch({ type: 'reset' });
        dispatch({ type: 'loadPhoto', photo });
        router.push('/analyzing');
      }
```

- [ ] **Step 6: 通過を確認**

Run: `npm test -w mobile && npm run typecheck -w mobile && npm run lint -w mobile`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add apps/mobile
git commit -m "feat(mobile): AI解析画面を実装し、ホームから解析へ進めるようにする" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 検出結果 → 編集ラベルの変換

**Files:**
- Modify: `apps/mobile/src/features/editor/reducer.ts`(`addLabels` アクション)
- Modify: `apps/mobile/__tests__/editor-reducer.test.ts`
- Create: `apps/mobile/src/features/analysis/items-to-labels.ts`
- Create: `apps/mobile/__tests__/items-to-labels.test.ts`

- [ ] **Step 1: 変換の失敗するテストを書く**

`apps/mobile/__tests__/items-to-labels.test.ts`:

```ts
import type { CropRect } from '@coordinate/layout';

import type { ResultItem } from '@/features/analysis/analysis-reducer';
import { itemsToLabelInputs } from '@/features/analysis/items-to-labels';

const item = (id: string, x: number, y: number, over: Partial<ResultItem> = {}): ResultItem => ({
  id,
  categoryId: 'tshirt',
  brand: '',
  box: { x, y, w: 0.2, h: 0.2 },
  origin: 'ai',
  level: 'unidentified',
  ...over,
});

const full: CropRect = { x: 0, y: 0, w: 1, h: 1 };
let n = 0;
const ids = () => `l_${++n}`;

describe('itemsToLabelInputs', () => {
  it('アンカーは枠の中心、名前はカテゴリ名、itemId は項目 ID', () => {
    const [l] = itemsToLabelInputs([item('a', 0.2, 0.3, { brand: 'NIKE' })], full, ids);
    expect(l).toMatchObject({ itemId: 'a', brand: 'NIKE', name: 'Tシャツ' });
    expect(l?.anchor?.x).toBeCloseTo(0.3);
    expect(l?.anchor?.y).toBeCloseTo(0.4);
    expect(l?.price).toBeUndefined();
  });

  it('左半分のアイテムのラベルは左、右半分は右に置く', () => {
    const [left, right] = itemsToLabelInputs([item('a', 0.1, 0.2), item('b', 0.7, 0.2)], full, ids);
    expect(left?.position?.x).toBeLessThan(0.3);
    expect(right?.position?.x).toBeGreaterThan(0.4);
  });

  it('同じ側で縦に近い項目は重ならないようにずらす', () => {
    const out = itemsToLabelInputs([item('a', 0.1, 0.2), item('b', 0.1, 0.22), item('c', 0.1, 0.24)], full, ids);
    const ys = out.map((l) => l.position?.y ?? 0);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.88);
  });

  it('トリミング後のキャンバス座標に変換し、外側は端に丸める', () => {
    const crop: CropRect = { x: 0.2, y: 0, w: 0.6, h: 1 };
    const [inside, outside] = itemsToLabelInputs([item('a', 0.4, 0.4), item('b', 0.0, 0.4)], crop, ids);
    // 中心 x=0.5 → (0.5-0.2)/0.6 = 0.5
    expect(inside?.anchor?.x).toBeCloseTo(0.5);
    // 中心 x=0.1 はトリミングの外 → 0 に丸める
    expect(outside?.anchor?.x).toBe(0);
  });

  it('ID は渡した関数で振り、順序を保つ', () => {
    n = 0;
    const out = itemsToLabelInputs([item('a', 0.1, 0.1), item('b', 0.7, 0.5)], full, ids);
    expect(out.map((l) => l.id)).toEqual(['l_1', 'l_2']);
    expect(out.map((l) => l.itemId)).toEqual(['a', 'b']);
  });

  it('カテゴリが未知なら名前は空にする', () => {
    const [l] = itemsToLabelInputs([item('a', 0.1, 0.1, { categoryId: 'unknown' })], full, ids);
    expect(l?.name).toBe('');
  });
});
```

`apps/mobile/__tests__/editor-reducer.test.ts` の末尾(`describe` の中)に追加:

```ts
  it('addLabels は複数ラベルを 1 回の履歴で追加し、元に戻すと一度に消える', () => {
    const s0 = run([{ type: 'loadPhoto', photo }]);
    const s1 = run(
      [
        {
          type: 'addLabels',
          inputs: [
            { id: 'a', itemId: 'i1', name: 'Tシャツ', anchor: { x: 0.3, y: 0.3 }, position: { x: 0.05, y: 0.2 } },
            { id: 'b', itemId: 'i2', name: '帽子' },
          ],
        },
      ],
      s0,
    );
    expect(doc(s1).labels.map((l) => l.id)).toEqual(['a', 'b']);
    expect(doc(s1).labels[0]?.anchor).toEqual({ x: 0.3, y: 0.3 });
    expect(doc(run([{ type: 'undo' }], s1)).labels).toHaveLength(0);
  });

  it('addLabels に空配列を渡しても履歴は増えない', () => {
    const s0 = run([{ type: 'loadPhoto', photo }]);
    expect(run([{ type: 'addLabels', inputs: [] }], s0)).toBe(s0);
  });
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w mobile -- items-to-labels editor-reducer` → FAIL

- [ ] **Step 3: reducer に `addLabels` を追加**

`apps/mobile/src/features/editor/reducer.ts`:

`EditorAction` に追加(`addLabel` の次の行):

```ts
  /** 複数ラベルを 1 回の履歴で追加する(AI の検出結果の引き継ぎ用)。 */
  | { type: 'addLabels'; inputs: NewLabelInput[] }
```

`switch` の `case 'removeLabel'` の前に追加:

```ts
    case 'addLabels': {
      if (action.inputs.length === 0) return state;
      const doc = action.inputs.reduce(addLabel, cur.doc);
      return { ...state, history: pushHistory(h, withDoc(cur, doc)) };
    }
```

- [ ] **Step 4: 変換を実装**

`apps/mobile/src/features/analysis/items-to-labels.ts`:

```ts
import type { CropRect, NewLabelInput } from '@coordinate/layout';
import { DEFAULT_CATEGORIES } from '@coordinate/shared';

import type { ResultItem } from './analysis-reducer';

const LEFT_X = 0.05;
const RIGHT_X = 0.52;
const MIN_GAP = 0.1;
const MAX_Y = 0.88;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const categoryName = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.labelJa ?? '';

/**
 * 認識結果をラベルの初期値に変換する。
 * アンカーはアイテム枠の中心(写真座標 → トリミング後のキャンバス座標)。
 * ラベルは中心が左半分なら左列、右半分なら右列に置き、同じ列で縦に近いものは MIN_GAP ずつずらす。
 * 返す順序は入力と同じ。
 */
export function itemsToLabelInputs(
  items: ResultItem[],
  crop: CropRect,
  newId: () => string,
): NewLabelInput[] {
  const anchors = items.map((it) => ({
    x: clamp01((it.box.x + it.box.w / 2 - crop.x) / crop.w),
    y: clamp01((it.box.y + it.box.h / 2 - crop.y) / crop.h),
  }));

  // 列ごとに、アンカーの y が小さい順に位置を決める。
  const positions = new Map<number, { x: number; y: number }>();
  for (const side of ['left', 'right'] as const) {
    const idx = anchors
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => (a.x < 0.5) === (side === 'left'))
      .sort((p, q) => p.a.y - q.a.y);
    let last = -Infinity;
    for (const { a, i } of idx) {
      const y = Math.min(Math.max(a.y - 0.04, last + MIN_GAP), MAX_Y);
      positions.set(i, { x: side === 'left' ? LEFT_X : RIGHT_X, y });
      last = y;
    }
  }

  return items.map((it, i) => ({
    id: newId(),
    itemId: it.id,
    brand: it.brand.trim(),
    name: categoryName(it.categoryId),
    anchor: anchors[i],
    position: positions.get(i),
  }));
}
```

- [ ] **Step 5: 通過を確認**

Run: `npm test -w mobile && npm run typecheck -w mobile && npm run lint -w mobile`
Expected: PASS。「ずらす」テストで最大 y が 0.88 を超える場合は、`Math.min(…, MAX_Y)` により MIN_GAP を満たせなくなる境界(項目 8 件以上など)の挙動になる。今回のテストは 3 件なので成立する。

- [ ] **Step 6: コミット**

```bash
git add apps/mobile
git commit -m "feat(mobile): 検出結果を編集ラベルへ変換し、複数ラベルを一括追加できるようにする" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 認識結果画面

**Files:**
- Modify: `apps/mobile/src/app/result.tsx`
- Modify: `apps/mobile/__tests__/screens.test.tsx`

写真上に枠と番号を重ね、下に一覧(カテゴリ・ブランド・識別レベル)を出す。ボタンは `AppButton`(最大幅 280px・中央)を使い、全幅にしない。デザインは既存画面(明朝の見出し・温かいオフホワイト)に合わせる。

- [ ] **Step 1: 失敗するテストを書く**

`screens.test.tsx` に追加(import に `ResultItem` 型や初期状態は下記のとおり)。ファイル冒頭の import に追加:

```tsx
import type { AnalysisState } from '@/features/analysis/analysis-reducer';
```

describe を追加:

```tsx
describe('認識結果画面', () => {
  const doneState = (over: Partial<Extract<AnalysisState, { status: 'done' }>> = {}): AnalysisState => ({
    status: 'done',
    items: [
      { id: 'a', categoryId: 'tshirt', brand: 'NIKE', box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, origin: 'ai', level: 'medium' },
      { id: 'b', categoryId: 'sneakers', brand: '', box: { x: 0.4, y: 0.8, w: 0.2, h: 0.15 }, origin: 'ai', level: 'unidentified' },
    ],
    quality: { ok: true, issues: [] },
    timings: { quality: 120, detect: 4200, total: 4400 },
    model: 'claude-sonnet-5-5',
    applied: false,
    ...over,
  });

  const renderResult = (state: AnalysisState) =>
    render(
      <EditorProvider initialState={loadedEditor}>
        <AnalysisProvider initialState={state}>
          <ResultScreen />
        </AnalysisProvider>
      </EditorProvider>,
    );

  it('検出したアイテムをカテゴリ・ブランドで一覧し、ブランド未検出は「ブランド不明」と出す', () => {
    renderResult(doneState());
    expect(screen.getByText('Tシャツ')).toBeTruthy();
    expect(screen.getByDisplayValue('NIKE')).toBeTruthy();
    expect(screen.getByText('スニーカー')).toBeTruthy();
    expect(screen.getByText('ブランド不明')).toBeTruthy();
    expect(screen.queryByText(/¥|円/)).toBeNull(); // Phase 3 では価格を出さない
  });

  it('品質の助言を表示する', () => {
    renderResult(doneState({ quality: { ok: false, issues: ['blurry', 'not_full_body'] } }));
    expect(screen.getByText(/ぼやけ/)).toBeTruthy();
    expect(screen.getByText(/全身/)).toBeTruthy();
  });

  it('ブランドを手入力でき、削除できる', () => {
    renderResult(doneState());
    fireEvent.changeText(screen.getByLabelText('スニーカーのブランド'), 'adidas');
    expect(screen.getByDisplayValue('adidas')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Tシャツを削除'));
    expect(screen.queryByText('Tシャツ')).toBeNull();
  });

  it('カテゴリを変更できる', () => {
    renderResult(doneState());
    fireEvent.press(screen.getByLabelText('Tシャツのカテゴリを変更'));
    fireEvent.press(screen.getByLabelText('ニット'));
    expect(screen.getByText('ニット')).toBeTruthy();
    expect(screen.queryByText('Tシャツ')).toBeNull();
  });

  it('検出 0 件でも手動で追加できる', () => {
    renderResult(doneState({ items: [] }));
    expect(screen.getByText('アイテムを見つけられませんでした')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('アイテムを追加'));
    fireEvent.press(screen.getByLabelText('帽子'));
    expect(screen.getByText('帽子')).toBeTruthy();
  });

  it('編集へ進むと検出結果が 1 回だけラベルとして渡される', () => {
    renderResult(doneState());
    fireEvent.press(screen.getByLabelText('この内容で編集へ'));
    expect(mockPush).toHaveBeenCalledWith('/editor');
  });

  it('解析結果が無ければホームへ戻る導線を出す', () => {
    render(withPhoto(<ResultScreen />));
    expect(screen.getByText('認識結果がありません。')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm test -w mobile -- screens` → FAIL

- [ ] **Step 3: 画面を実装**

`apps/mobile/src/app/result.tsx`:

```tsx
import { computeCrop } from '@coordinate/layout';
import { DEFAULT_CATEGORIES, type QualityIssue } from '@coordinate/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppButton } from '@/components/app-button';
import { Chip } from '@/components/controls';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { newItemId, useAnalysis } from '@/features/analysis/analysis-context';
import type { ResultItem } from '@/features/analysis/analysis-reducer';
import { itemsToLabelInputs } from '@/features/analysis/items-to-labels';
import { newLabelId, useEditor } from '@/features/editor/editor-context';
import { currentCrop } from '@/features/editor/reducer';
import { useTheme } from '@/hooks/use-theme';

const GROUPS = [
  ['clothing', '衣類'],
  ['shoes', '靴'],
  ['bag', 'バッグ'],
  ['accessory', 'アクセサリー'],
] as const;

const ISSUE_TEXT: Record<QualityIssue, string> = {
  low_resolution: '解像度が低い写真です。細部(文字やロゴ)が読み取れない場合があります。',
  too_dark: '暗い写真です。明るい場所で撮った写真のほうが正確に検出できます。',
  blurry: '写真がぼやけているようです。ブランド名が読み取れない場合があります。',
  not_full_body: '全身が写っていないようです。写っていないアイテムは検出されません。',
};

const categoryName = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.labelJa ?? id;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}秒`;

export default function ResultScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { snapshot, dispatch: editorDispatch } = useEditor();
  const { state, dispatch } = useAnalysis();
  // どの項目のカテゴリ選択を開いているか。'new' は手動追加。
  const [picking, setPicking] = useState<string | null>(null);

  if (!snapshot || state.status !== 'done') {
    return (
      <Screen>
        <ThemedText>認識結果がありません。</ThemedText>
        <AppButton label="ホームに戻る" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const { photo } = snapshot;

  const proceed = () => {
    if (!state.applied) {
      const crop = currentCrop(snapshot);
      const inputs = itemsToLabelInputs(state.items, crop, newLabelId);
      editorDispatch({ type: 'addLabels', inputs });
      dispatch({ type: 'applied' });
    }
    router.push('/editor');
  };

  return (
    <Screen>
      <View style={styles.head}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Detected items
        </ThemedText>
        <ThemedText type="title">写っているアイテム</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {`品質確認 ${seconds(state.timings.quality)} ・ 検出 ${seconds(state.timings.detect)}`}
        </ThemedText>
      </View>

      <View style={[styles.photoWrap, { aspectRatio: photo.width / photo.height, borderColor: theme.border }]}>
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {state.items.map((it, i) => (
          <View
            key={it.id}
            pointerEvents="none"
            style={[
              styles.box,
              {
                left: `${it.box.x * 100}%`,
                top: `${it.box.y * 100}%`,
                width: `${it.box.w * 100}%`,
                height: `${it.box.h * 100}%`,
              },
            ]}>
            <View style={styles.badge}>
              <ThemedText type="small" style={styles.badgeText}>
                {i + 1}
              </ThemedText>
            </View>
          </View>
        ))}
      </View>

      {state.quality.issues.length > 0 ? (
        <View style={[styles.notice, { borderColor: theme.border }]}>
          {state.quality.issues.map((issue) => (
            <ThemedText key={issue} type="small" themeColor="textSecondary">
              {ISSUE_TEXT[issue]}
            </ThemedText>
          ))}
        </View>
      ) : null}

      {state.items.length === 0 ? (
        <View style={styles.notice}>
          <ThemedText type="subtitle">アイテムを見つけられませんでした</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            下のボタンから手動で追加できます。
          </ThemedText>
        </View>
      ) : null}

      {state.items.map((it, i) => (
        <ItemCard
          key={it.id}
          index={i + 1}
          item={it}
          pickingCategory={picking === it.id}
          onTogglePick={() => setPicking(picking === it.id ? null : it.id)}
          onPick={(categoryId) => {
            dispatch({ type: 'setCategory', id: it.id, categoryId });
            setPicking(null);
          }}
          onBrand={(brand) => dispatch({ type: 'setBrand', id: it.id, brand })}
          onRemove={() => dispatch({ type: 'remove', id: it.id })}
        />
      ))}

      {picking === 'new' ? (
        <CategoryPicker
          onPick={(categoryId) => {
            dispatch({ type: 'addManual', id: newItemId(), categoryId });
            setPicking(null);
          }}
        />
      ) : null}

      <View style={styles.buttons}>
        <AppButton
          label="アイテムを追加"
          variant="secondary"
          onPress={() => setPicking(picking === 'new' ? null : 'new')}
        />
        <AppButton label="この内容で編集へ" onPress={proceed} />
      </View>
    </Screen>
  );
}

function ItemCard({
  index,
  item,
  pickingCategory,
  onTogglePick,
  onPick,
  onBrand,
  onRemove,
}: {
  index: number;
  item: ResultItem;
  pickingCategory: boolean;
  onTogglePick: () => void;
  onPick: (categoryId: string) => void;
  onBrand: (brand: string) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const name = categoryName(item.categoryId);
  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.index}>
          {String(index).padStart(2, '0')}
        </ThemedText>
        <ThemedText type="subtitle" style={{ flex: 1 }}>
          {name}
        </ThemedText>
        <Chip
          label="変更"
          accessibilityLabel={`${name}のカテゴリを変更`}
          selected={pickingCategory}
          onPress={onTogglePick}
        />
      </View>
      {pickingCategory ? <CategoryPicker onPick={onPick} /> : null}

      <TextInput
        accessibilityLabel={`${name}のブランド`}
        value={item.brand}
        onChangeText={onBrand}
        placeholder="ブランド名(任意)"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, borderColor: theme.border, fontFamily: Fonts.sans }]}
      />
      {item.brand.trim() === '' ? (
        <ThemedText type="small" themeColor="textSecondary">
          ブランド不明
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {item.origin === 'ai' && item.level !== 'unidentified' ? '写真内の文字から読み取りました' : '入力した内容です'}
        </ThemedText>
      )}
      <View style={styles.cardFoot}>
        <Chip label="削除" accessibilityLabel={`${name}を削除`} selected={false} onPress={onRemove} />
      </View>
    </View>
  );
}

function CategoryPicker({ onPick }: { onPick: (categoryId: string) => void }) {
  return (
    <View style={styles.picker}>
      {GROUPS.map(([group, label]) => (
        <View key={group} style={styles.pickerGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            {label}
          </ThemedText>
          <View style={styles.chips}>
            {DEFAULT_CATEGORIES.filter((c) => c.group === group).map((c) => (
              <Chip key={c.id} label={c.labelJa} selected={false} onPress={() => onPick(c.id)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.two },
  photoWrap: { width: '100%', borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  box: { position: 'absolute', borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 4 },
  badge: {
    position: 'absolute',
    top: -1,
    left: -1,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    backgroundColor: '#1B1A19',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', lineHeight: 18 },
  notice: { gap: Spacing.one },
  card: { gap: Spacing.two, padding: Spacing.three, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth * 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  index: { width: 28 },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  cardFoot: { flexDirection: 'row', justifyContent: 'flex-end' },
  picker: { gap: Spacing.three },
  pickerGroup: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  buttons: { gap: Spacing.three },
});
```

注意(実装者向け):
- 先に `apps/mobile/src/components/controls.tsx` の `Chip` に任意の `accessibilityLabel?: string` を足す(`accessibilityLabel={accessibilityLabel ?? label}`)。既存の呼び出しは変えない。
- `expo-image` の `Image` が jest-expo でレンダリングできない場合は、`screens.test.tsx` の先頭で `jest.mock('expo-image', () => ({ Image: () => null }))` する。

- [ ] **Step 4: 通過を確認**

Run: `npm test -w mobile && npm run typecheck -w mobile && npm run lint -w mobile`
Expected: PASS(ESLint の `react-hooks` に引っかかる場合は、状態を props に落とす/ref を使わない形にする)

- [ ] **Step 5: コミット**

```bash
git add apps/mobile
git commit -m "feat(mobile): 認識結果画面を実装(確認・カテゴリ変更・ブランド入力・削除・手動追加)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: 実 Claude での評価・モデル比較・エミュレータ確認・ドキュメント更新

ここだけが実 Claude を呼ぶ。**費用が発生するため、開始前にユーザーの了承を得る**(写真の枚数 × モデル数 × 1 回)。API キーは `apps/api/.env` にユーザーが設定する。チャットに貼らせない。

**Files:**
- Create: `apps/api/scripts/eval.ts`
- Create: `docs/phase3-model-comparison.md`(実測の結果)
- Modify: `docs/progress.md`, `docs/limitations.md`(必要なら)

- [ ] **Step 1: 評価スクリプトを書く**

`apps/api/scripts/eval.ts`:

```ts
/**
 * 実 Claude を呼ぶ評価。手元のコーデ写真(apps/api/eval/photos/*.jpg|png)に対して、
 * 指定したモデルごとに検出を実行し、件数・ブランド採用数・トークン数・所要時間・概算費用を表にする。
 * キーが無ければ何もせず終了する。画像は保存・送信先の変更をしない(API へ送るのみ)。
 *
 * 使い方: npm run eval -w api -- --models claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { loadConfig } from '../src/config';
import { ClaudeVisionDetector } from '../src/detector/claude-vision-detector';
import { prepareForModel } from '../src/image/prepare-image';
import { assessQuality } from '../src/image/quality';
import { validateImage } from '../src/image/validate-image';
import { estimateCostUsd } from '../src/usage';

async function main() {
  const config = loadConfig();
  if (!config.anthropicApiKey) {
    console.log('ANTHROPIC_API_KEY が未設定のため、評価をスキップしました。');
    return;
  }
  const arg = process.argv.find((a) => a.startsWith('--models='))?.slice('--models='.length)
    ?? process.argv[process.argv.indexOf('--models') + 1];
  const models = (arg && !arg.startsWith('--') ? arg : config.model).split(',').map((m) => m.trim());

  const dir = join(__dirname, '..', 'eval', 'photos');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
  } catch {
    // ディレクトリが無い
  }
  if (files.length === 0) {
    console.log(`写真がありません。${dir} にコーデ写真を置いてください(Git 管理外)。`);
    return;
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 120_000, maxRetries: 1 });
  const rows: Record<string, unknown>[] = [];

  for (const file of files) {
    const data = readFileSync(join(dir, file));
    if (!validateImage(data).ok) continue;
    const quality = await assessQuality(data);
    const prepared = await prepareForModel(data);
    for (const model of models) {
      const detector = new ClaudeVisionDetector(client, model, config.effort);
      const t = performance.now();
      try {
        const r = await detector.detect(prepared);
        rows.push({
          file,
          model,
          qualityIssues: quality.issues.join('|') || '-',
          items: r.items.length,
          withBrand: r.items.filter((i) => i.brandCandidates.length > 0).length,
          fullBody: r.fullBody,
          inTok: r.usage.inputTokens,
          outTok: r.usage.outputTokens,
          ms: Math.round(performance.now() - t),
          usd: estimateCostUsd(r.usage, config.pricing)?.toFixed(4) ?? '-',
          categories: r.items.map((i) => i.categoryId).join(','),
          brands: r.items.map((i) => i.brandCandidates[0]?.name ?? '-').join(','),
        });
      } catch (e) {
        rows.push({ file, model, error: (e as Error).name });
      }
    }
  }

  console.table(rows);
  const outDir = join(__dirname, '..', 'eval', 'results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(rows, null, 2));
}

void main();
```

Run: `npm run typecheck -w api`
Expected: 型エラーなし(`__dirname` は CJS 実行の tsx で使える)

- [ ] **Step 2: 実行前にユーザーの了承と準備を得る**

ユーザーに次を伝えて確認する: (a) `apps/api/.env` に `ANTHROPIC_API_KEY` を設定する(チャットに貼らない)、(b) `apps/api/eval/photos/` にコーデ写真を 5〜10 枚置く(ブランド文字が見えるものと見えないものを混ぜる)、(c) 比較モデルは `claude-sonnet-5-5` / `claude-haiku-5-5` / `claude-opus-5-5`、(d) 費用の目安(`PRICE_*` を `.env` に設定すると概算が出る。単価は Anthropic の最新の料金表で確認して設定する)。

- [ ] **Step 3: 評価を実行する**

Run: `npm run eval -w api -- --models claude-sonnet-5-5,claude-haiku-5-5,claude-opus-5-5`
Expected: 写真 × モデルの表が出る。エラー行(`error`)があれば原因を調べて直す(モデル ID・`output_config` の受理など)。**refusal・invalid_output が出る頻度も記録する。**

- [ ] **Step 4: 結果を人が目で確認して記録する**

各写真について、検出されたカテゴリ・枠・ブランドが写真と合っているかを目視で確認する。評価は「合っている/ずれている/ブランドを誤読した」を数え、`docs/phase3-model-comparison.md` に表で記録する(モデル別: 検出の正確さ、ブランド誤読数、平均トークン、平均所要時間、概算費用、refusal 等の失敗数)。**ブランドの誤読(根拠文字が実際には読めていないのに採用された)が 1 件でもあれば、プロンプトと `normalize` の根拠判定を見直す。** 品質評価のしきい値(`THRESHOLDS`)も、ぼけ写真・暗い写真で想定どおり検出されるかを確認して調整する(調整したらテストの合成画像が通ることも確認する)。

その結果をもとに、`.env.example` の `ANTHROPIC_MODEL` の既定値と `config.ts` の既定値を確定する(ユーザーと相談する。精度・費用・速度のどれを優先するか)。

- [ ] **Step 5: エミュレータで通しの動作を確認する**

1. `cd apps/api && npm start`(`.env` 読み込み済み)。別ターミナルで `curl localhost:8787/health` が `detectorConfigured: true`。
2. エミュレータ起動と開発ビルドの接続は `docs/progress.md` の手順に従う。`apps/mobile/.env`(Git 管理外)に `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8787` を設定し、Metro を再起動する。
3. 写真を選ぶ → 解析 → 認識結果 → 編集 → 書き出し まで通して操作し、画面を確認する。見るべき点: 枠の位置が写真と合う/ブランド不明の表示/カテゴリ変更・削除・手動追加/編集画面でラベルが枠の近くに出る/下書きのクラッシュが無い。
4. Android の開発ビルドで `http://10.0.2.2` への通信が拒否される場合(cleartext)は、開発用の設定(`expo-build-properties` の `usesCleartextTraffic`)が必要。**本番向けには入れない**ことをユーザーに伝えて判断してもらう。
5. キーを外して API を再起動し、`not_configured` の文言(「解析サーバーが未設定です」)がアプリに出ることも確認する。

実機/エミュレータで実際に Claude を呼んだ結果と、モックのテストの結果は **別の項目として** 報告する。

- [ ] **Step 6: ドキュメントを更新してコミット**

`docs/progress.md` を更新する: 現在地を「Phase 3 完了」に、テスト件数、モデル比較の要約と確定したモデル、エミュレータでの確認結果、`apps/api` の起動手順(`.env`、`npm start -w api`、`EXPO_PUBLIC_API_BASE_URL`)、判明した注意点を追記する。「Phase 3 の設計」節を実装済みに書き換え、次は Phase 4(着手前に必要: 公式ドキュメント・料金・規約の調査と報告、SerpApi キー、楽天のアプリ登録)と明記する。`docs/limitations.md` に、ブランド読み取りの限界(文字が見えない場合は不明)を追記する。メモリ(`coordinate-project-status.md`)も更新する。

```bash
npm test && npm run typecheck && npm run lint
git add docs apps/api .env.example
git commit -m "docs: Phase 3 の実測結果とモデル比較を記録し、進捗を更新" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: shared / layout / api / mobile のテストがすべて成功し、型検査・lint にエラーなし。

---

## セルフレビュー

**設計書との対応**

| 設計の要件 | タスク |
|---|---|
| `packages/shared` の型・スキーマ(Detector、UsageRecord、レスポンス) | 1 |
| `apps/api`(Fastify、環境変数、画像検証、ヘルスチェック、レート制限の入口) | 3, 4, 7 |
| 写真品質評価(sharp。全身は検出結果から) | 5, 7 |
| `ClaudeVisionDetector`・モデル切替・zod 検証・不正値の破棄 | 6 |
| ブランドは読めた文字のみ、推測しない | 6(プロンプト + `normalize` の根拠判定) |
| トークン数・処理時間の記録(画像・キーを含まない) | 6, 7 |
| エラー表(400 / 502 / 503 / 0 件) | 7(API)、10, 12(アプリ表示) |
| 画像を保存しない | 4, 7(メモリ上のみ。評価スクリプトも読み込むだけ) |
| `analyzing` 画面(偽の進捗バーにしない) | 10(スピナーのみ。内訳は結果画面に実測値で表示) |
| `result` 画面(確認・カテゴリ変更・ブランド手入力・削除・手動追加) | 9, 12 |
| 編集画面へのラベル受け渡し(Box から初期位置) | 2, 11, 12 |
| 実測とモデル比較、`npm run eval`(キーが無ければスキップ) | 13 |
| ダミー商品を出さない・確信度の数値を表示しない | 全体(`candidates: []`、UI は段階/文言のみ) |

**設計からの変更点(ユーザーへ報告する)**
1. 「ツール呼び出し(JSON スキーマ指定)」→ **構造化出力**。Sonnet 5.5 は `tool_choice` の強制が 400 になるため。検証(zod)と破棄の方針は同じ。
2. 段階表示(品質確認 → 検出 → 切り抜き → 特徴抽出)のうち「切り抜き・特徴抽出」は Phase 3 では行わないため表示しない。`analyzing` はスピナー、完了後に `result` 上部へ実測の所要時間(品質確認・検出)を出す。
3. サーバー側フォールバック(refusal 時の別モデル再試行)は使わない。refusal は 502。

**型・名前の整合**: `Detector` / `DetectorImage` / `DetectorResult` / `Usage`(Task 1)→ 検出器(6)・ルート(7)・評価(13)で同名。`NewLabelInput.anchor/position`(2)→ `itemsToLabelInputs`(11)・`addLabels`(11)で使用。`ResultItem` / `AnalysisState.applied`(9)→ 画面(12)。`AnalyzeError` / `ERROR_MESSAGES`(8)→ 画面(10)。`Effort`(3)→ 検出器(6)。
