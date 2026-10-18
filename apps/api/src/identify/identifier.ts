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
import { containsWholeWords } from '../detector/normalize';
import type { ProductSearcher, SearchOutcome } from '../search/types';
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
/** 照合に渡す候補の最大数。 */
const COMPARE_LIMIT = 12;
/** 照合に渡す、SerpApi の候補の最大数。残りは楽天(楽天が少なければ SerpApi の残りで埋める)。 */
const SERPAPI_LIMIT = 8;
/** 照合に渡す、Lens の候補の最大数。 */
const LENS_LIMIT = 8;
/** Lens の「使える候補」(商品ページと画像がある行)がこの件数以上なら、テキスト検索は行わない。 */
const LENS_ENOUGH = 3;
/** 全体の締め切りの既定値(ミリ秒)。 */
const DEFAULT_DEADLINE_MS = 100_000;
/** 経過時間が締め切りのこの割合を超えたら、テキスト検索を始めない。 */
const TEXT_SEARCH_CUTOFF = 0.7;

type Deps = {
  queryGenerator: Pick<QueryGenerator, 'generate'>;
  comparer: Pick<Comparer, 'compare'>;
  /** 画像検索。キー未設定なら null。 */
  lens: { searchByImage(jpeg: Uint8Array): Promise<SearchOutcome> } | null;
  /** 切り抜きを Lens 用の JPEG にする(本番は prepareForLens)。 */
  prepareLens: (data: Uint8Array) => Promise<Uint8Array>;
  serpapi: ProductSearcher;
  rakuten: ProductSearcher;
  maxSearchesPerProvider: number;
  pricing: Config['pricing'];
  serpapiCostPerSearchUsd: number | null;
  now?: () => Date;
  /** 1 回の特定全体の締め切り(ミリ秒)。 */
  deadlineMs?: number;
  /** 経過時間の計測に使う時計(ミリ秒)。テストで偽の時計を渡す。 */
  nowMs?: () => number;
};

type Collected = { products: Product[]; status: SearchStatus; calls: number };

export class Identifier {
  constructor(private readonly deps: Deps) {}

  /**
   * onUsage は、Claude の応答を受け取るたびに(成功・検証失敗を問わず)呼ばれる。
   * 後続の処理が失敗しても、課金された使用量を呼び出し側が計上できるようにするため。
   */
  async identify(
    image: DetectorImage,
    item: DetectedItem,
    opts: {
      /** 利用者が画像検索(Lens)に同意しているか。false または省略なら Lens は実行しない。 */
      consent?: boolean;
      onUsage?: (usage: Usage) => void;
      /** 検索が失敗したとき、検索元と理由の種類(http_429 など)を通知する。キー・URL・検索語は含まれない。 */
      onSearchFailure?: (provider: 'serpapi' | 'rakuten' | 'lens', detail: string) => void;
    } = {},
  ): Promise<IdentifyResponse> {
    const clock = this.deps.nowMs ?? (() => performance.now());
    const deadlineMs = this.deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
    const t0 = clock();
    const elapsed = () => clock() - t0;
    const now = (this.deps.now ?? (() => new Date()))();
    const report = (u: Usage) => {
      try {
        opts.onUsage?.(u);
      } catch {
        // 計上側の失敗で結果を妨げない。
      }
    };
    const failure = (provider: 'serpapi' | 'rakuten' | 'lens', detail: string) => {
      try {
        opts.onSearchFailure?.(provider, detail);
      } catch {
        // ログ側の失敗で結果を妨げない。
      }
    };
    // Lens は検索語の生成と並行して始める。例外にはならない(失敗は status で表す)。
    const lensPromise = this.runLens(image, opts.consent === true);
    let gen;
    try {
      gen = await this.deps.queryGenerator.generate(item);
    } catch (e) {
      const u = usageOf(e);
      if (u) report(u);
      throw e;
    }
    report(gen.usage);

    const lensOut = await lensPromise;
    if (lensOut.status === 'failed') failure('lens', lensOut.detail ?? 'unknown');
    // 重複(同じ source と productId、または同じ pageUrl)は、Lens・SerpApi・楽天をまたいで除く。
    const seenKeys = new Set<string>();
    const seenPages = new Set<string>();
    const dedupe = (list: Product[]) =>
      list.filter((p) => {
        const k = `${p.source}:${p.productId}`;
        if (seenKeys.has(k) || (p.pageUrl !== undefined && seenPages.has(p.pageUrl))) return false;
        seenKeys.add(k);
        if (p.pageUrl !== undefined) seenPages.add(p.pageUrl);
        return true;
      });
    // 商品ページと画像がある行だけを「使える候補」とする(画像が無いと照合できない)。
    const lensUsable = dedupe(lensOut.status === 'ok' ? lensOut.products.filter((p) => p.pageUrl && p.imageUrl) : []);

    // Lens だけで足りるときは、テキスト検索を呼ばない(その検索元は ok・0 回として扱う)。
    const needText = lensOut.status !== 'ok' || lensUsable.length < LENS_ENOUGH;
    const skipped: Collected = { products: [], status: 'ok', calls: 0 };
    // 経過時間が締め切りの 70% を超えていたら、テキスト検索は始めない(時間切れとして failed にする)。
    const tooLate = needText && elapsed() > deadlineMs * TEXT_SEARCH_CUTOFF;
    if (tooLate) {
      failure('serpapi', 'deadline');
      failure('rakuten', 'deadline');
    }
    const timedOut: Collected = { products: [], status: 'failed', calls: 0 };
    const [serp, rak] = tooLate
      ? [timedOut, timedOut]
      : needText
        ? await Promise.all([
            this.collect(this.deps.serpapi, gen.queries, (d) => failure('serpapi', d)),
            // 楽天は AND 検索なので、語数の多い具体的な検索語では 0 件になりやすい。一般的な語(後ろ)から試す。
            this.collect(this.deps.rakuten, [...gen.queries].reverse(), (d) => failure('rakuten', d)),
          ])
        : [skipped, skipped];
    const usable = (s: SearchStatus) => s === 'ok';
    // Lens が成功していれば検索自体はできている(テキストが全滅でも、候補 0 件の C にする)。
    if (lensOut.status !== 'ok' && !usable(serp.status) && !usable(rak.status)) throw new SearchUnavailableError();

    // Lens を最大 8 件、続けて SerpApi・楽天。重複(同じ source と productId、または同じ pageUrl)を除く。
    // 残りの枠(COMPARE_LIMIT - Lens の件数)のうち、楽天を最大 4 件、SerpApi は最大 8 件まで取り、
    // 楽天が少なければ SerpApi の残りで枠を埋める。
    const lensTake = lensUsable.slice(0, LENS_LIMIT);
    const room = COMPARE_LIMIT - lensTake.length;
    const serpAll = dedupe(serp.products);
    const rakAll = dedupe(rak.products).slice(0, Math.min(room, COMPARE_LIMIT - SERPAPI_LIMIT));
    const merged = [...lensTake, ...serpAll.slice(0, room - rakAll.length), ...rakAll];

    // クライアントの申告を信用せず、ブランドが写真の読み取り文字に語として現れるときだけ採用する。
    const claimed = item.brandCandidates[0]?.name ?? null;
    const brandRead =
      claimed !== null && item.appearance.visibleText.some((t) => containsWholeWords(claimed, t)) ? claimed : null;
    let claude: Usage = gen.usage;
    let comparison: IdentifyResponse['comparison'] = 'skipped';
    let verdict: IdentifyResponse['verdict'];
    let candidates: IdentifyCandidate[];

    // 照合を行えなかった(失敗・時間切れ)ために、候補を「未照合」で返したか。
    let unverified = false;
    const unverifiedCandidates = (reason: string): IdentifyCandidate[] =>
      merged.slice(0, MAX_CANDIDATES).map((product) => ({
        product,
        matchScore: 0,
        matchType: 'similar' as const,
        matched: [],
        unconfirmed: [reason],
      }));

    if (merged.length === 0) {
      ({ verdict, candidates } = decideVerdict({ brandRead, candidates: [], judgements: [] }));
    } else if (elapsed() > deadlineMs) {
      // 締め切りを超えているので、照合は省く。
      unverified = true;
      verdict = 'candidates';
      candidates = unverifiedCandidates('時間がかかったため、画像との照合を省きました');
    } else {
      try {
        const cmp = await this.deps.comparer.compare(image, merged, {
          timeoutMs: Math.max(1, Math.floor(deadlineMs - elapsed())),
        });
        report(cmp.usage);
        claude = add(claude, cmp.usage);
        comparison = 'done';
        ({ verdict, candidates } = decideVerdict({ brandRead, candidates: merged, judgements: cmp.judgements }));
      } catch (e) {
        const u = usageOf(e);
        if (u) {
          report(u);
          claude = add(claude, u);
        }
        // 照合できなかった場合は、確定させず、候補を「未照合」として返す。
        comparison = 'failed';
        unverified = true;
        verdict = 'candidates';
        candidates = unverifiedCandidates('画像との照合ができませんでした');
      }
    }

    // 照合できていないときは、ブランドを読めていても確からしさを上げない。
    const level = unverified ? 'low' : verdictToLevel(verdict, brandRead !== null);
    const serpapiSearches = serp.calls;
    const rakutenCalls = rak.calls;
    const claudeCost = estimateCostUsd(claude, this.deps.pricing);
    const lensSearches = lensOut.calls;
    // Lens(アップロードを含む)も SerpApi の検索として数える。
    const serpCost =
      this.deps.serpapiCostPerSearchUsd === null ? 0 : (serpapiSearches + lensSearches) * this.deps.serpapiCostPerSearchUsd;

    return {
      itemId: item.id,
      verdict,
      level,
      rationale: rationale(verdict, unverified),
      candidates,
      searches: { serpapi: serp.status, rakuten: rak.status, lens: lensOut.status },
      comparison,
      queries: gen.queries,
      usage: { claude, serpapiSearches, rakutenCalls, lensSearches },
      estimatedCostUsd: claudeCost === null ? null : claudeCost + serpCost,
      fetchedAt: now.toISOString(),
      timings: { total: Math.round(elapsed()) },
    };
  }

  /** 同意・設定を確かめて Lens を実行する。例外は投げず、失敗は status で返す(理由の detail に画像・URL は含めない)。 */
  private async runLens(image: DetectorImage, consent: boolean): Promise<SearchOutcome> {
    if (!consent) return { status: 'not_consented', products: [], calls: 0 };
    const lens = this.deps.lens;
    if (!lens) return { status: 'not_configured', products: [], calls: 0 };
    let jpeg: Uint8Array;
    try {
      jpeg = await this.deps.prepareLens(image.data);
    } catch {
      return { status: 'failed', products: [], calls: 0, detail: 'prepare' };
    }
    try {
      return await lens.searchByImage(jpeg);
    } catch {
      return { status: 'failed', products: [], calls: 0, detail: 'unknown' };
    }
  }

  /**
   * 1 つ目の検索語で検索し、候補が少なければ 2 つ目で 1 回だけ追加検索する。
   * 1 つ目が ok なら、2 つ目が失敗しても status は ok のままにする(得られた候補は有効なため)。
   */
  private async collect(
    searcher: ProductSearcher,
    queries: string[],
    onFailure: (detail: string) => void,
  ): Promise<Collected> {
    const out: Collected = { products: [], status: 'failed', calls: 0 };
    const max = Math.min(this.deps.maxSearchesPerProvider, queries.length);
    for (let i = 0; i < max; i++) {
      const r = await searcher.search(queries[i]!);
      out.calls += r.calls;
      if (r.status === 'failed') onFailure(r.detail ?? 'unknown');
      if (r.status !== 'ok') {
        if (i === 0) out.status = r.status;
        break;
      }
      out.status = 'ok';
      out.products.push(...r.products);
      if (out.products.length >= ENOUGH) break;
    }
    return out;
  }
}

/** 応答を受け取ったあとの検証失敗(QueryGenerationError・ComparisonError)が持つ使用量。 */
function usageOf(e: unknown): Usage | undefined {
  const u = (e as { usage?: Usage } | null)?.usage;
  return u && Number.isFinite(u.inputTokens) && Number.isFinite(u.outputTokens) ? u : undefined;
}

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

function rationale(verdict: IdentifyResponse['verdict'], unverified: boolean): string {
  if (verdict === 'identified') return '写真の文字・商品名・画像が一致する商品を確認できました';
  if (verdict === 'candidates') {
    return unverified
      ? '候補は見つかりましたが、画像との照合ができなかったため、確定できません'
      : '似た商品は見つかりましたが、同じ商品とは確認できませんでした';
  }
  return '手がかりが足りず、商品を特定できませんでした';
}
