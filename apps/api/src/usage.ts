import type { Usage } from '@coordinate/shared';

import type { Config } from './config';

/** 概算の USD。単価は設定値で、ソースに固定しない。未設定なら null。 */
export function estimateCostUsd(usage: Usage, pricing: Config['pricing']): number | null {
  if (!pricing) return null;
  return (usage.inputTokens * pricing.inputPerMTok + usage.outputTokens * pricing.outputPerMTok) / 1_000_000;
}
