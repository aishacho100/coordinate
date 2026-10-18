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

  /**
   * onUsage は、Claude の応答を受け取るたびに(成功・検証失敗を問わず)呼ばれる。
   * 後続の処理が失敗しても、課金された使用量を呼び出し側が計上できるようにするため。
   */
  async identify(
    image: DetectorImage,
    item: DetectedItem,
    opts: { onUsage?: (usage: Usage) => void } = {},
  ): Promise<IdentifyResponse> {
    const t0 = performance.now();
    const now = (this.deps.now ?? (() => new Date()))();
    const report = (u: Usage) => {
      try {
        opts.onUsage?.(u);
      } catch {
        // 計上側の失敗で結果を妨げない。
      }
    };
    let gen;
    try {
      gen = await this.deps.queryGenerator.generate(item);
    } catch (e) {
      const u = usageOf(e);
      if (u) report(u);
      throw e;
    }
    report(gen.usage);

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

    // クライアントの申告を信用せず、ブランドが写真の読み取り文字に語として現れるときだけ採用する。
    const claimed = item.brandCandidates[0]?.name ?? null;
    const brandRead =
      claimed !== null && item.appearance.visibleText.some((t) => containsWholeWords(claimed, t)) ? claimed : null;
    let claude: Usage = gen.usage;
    let comparison: IdentifyResponse['comparison'] = 'skipped';
    let verdict: IdentifyResponse['verdict'];
    let candidates: IdentifyCandidate[];

    if (merged.length === 0) {
      ({ verdict, candidates } = decideVerdict({ brandRead, candidates: [], judgements: [] }));
    } else {
      try {
        const cmp = await this.deps.comparer.compare(image, merged);
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

    // 照合できていないときは、ブランドを読めていても確からしさを上げない。
    const level = comparison === 'failed' ? 'low' : verdictToLevel(verdict, brandRead !== null);
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

  /**
   * 1 つ目の検索語で検索し、候補が少なければ 2 つ目で 1 回だけ追加検索する。
   * 1 つ目が ok なら、2 つ目が失敗しても status は ok のままにする(得られた候補は有効なため)。
   */
  private async collect(searcher: ProductSearcher, queries: string[]): Promise<Collected> {
    const out: Collected = { products: [], status: 'failed', calls: 0 };
    const max = Math.min(this.deps.maxSearchesPerProvider, queries.length);
    for (let i = 0; i < max; i++) {
      const r = await searcher.search(queries[i]!);
      out.calls += r.calls;
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

function rationale(verdict: IdentifyResponse['verdict'], comparison: IdentifyResponse['comparison']): string {
  if (verdict === 'identified') return '写真の文字・商品名・画像が一致する商品を確認できました';
  if (verdict === 'candidates') {
    return comparison === 'failed'
      ? '候補は見つかりましたが、画像との照合ができなかったため、確定できません'
      : '似た商品は見つかりましたが、同じ商品とは確認できませんでした';
  }
  return '手がかりが足りず、商品を特定できませんでした';
}
