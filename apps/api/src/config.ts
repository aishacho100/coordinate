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
