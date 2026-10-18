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
