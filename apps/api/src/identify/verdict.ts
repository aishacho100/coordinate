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
/** A に必要な最低の類似度。B より厳しくする。 */
export const MIN_IDENTICAL_SIMILARITY = 0.7;
export const MAX_CANDIDATES = 5;

/** 有限でない値(NaN・Infinity)は 0 として扱い、0〜1 に収める。 */
const clampSimilarity = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);

/**
 * A・B・C を決める。A は「写真の文字からブランドを読み取れている」「候補名に同じブランドが語として現れる」
 * 「候補に画像がある」「画像が同一商品と判断された」「名前や型番が読み取れた文字・特徴と合う」を全部満たすときだけ。
 * (加えて、類似度が A 専用の下限 MIN_IDENTICAL_SIMILARITY 以上であること。)
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
    valid.push({ product, judgement: { ...jd, similarity: clampSimilarity(jd.similarity) } });
  }
  valid.sort((a, b) => b.judgement.similarity - a.judgement.similarity);

  const isIdentical = ({ product, judgement }: (typeof valid)[number]) =>
    input.brandRead !== null &&
    containsWholeWords(input.brandRead, `${product.brand} ${product.name}`) &&
    product.imageUrl !== undefined &&
    judgement.sameProduct &&
    judgement.nameMatchesFeatures &&
    judgement.similarity >= MIN_IDENTICAL_SIMILARITY;

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
