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
};

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

function positiveNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MAX_CACHE_TTL_SECONDS = 3600;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const effort = EFFORTS.find((e) => e === env.ANTHROPIC_EFFORT) ?? 'medium';
  const priceIn = positiveNumber(env.PRICE_INPUT_PER_MTOK);
  const priceOut = positiveNumber(env.PRICE_OUTPUT_PER_MTOK);
  const nonEmpty = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const rakutenId = nonEmpty(env.RAKUTEN_APPLICATION_ID);
  const rakutenKey = nonEmpty(env.RAKUTEN_ACCESS_KEY);
  const perInstall = positiveNumber(env.IDENTIFY_DAILY_LIMIT) ?? 30;
  return {
    port: positiveNumber(env.PORT) ?? 8787,
    anthropicApiKey: key ? key : null,
    model: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5',
    effort,
    maxImageBytes: 10 * 1024 * 1024,
    ratePerMinute: positiveNumber(env.RATE_LIMIT_PER_MINUTE) ?? 20,
    pricing: priceIn !== null && priceOut !== null ? { inputPerMTok: priceIn, outputPerMTok: priceOut } : null,
    serpapiKey: nonEmpty(env.SERPAPI_API_KEY),
    rakuten:
      rakutenId && rakutenKey
        ? { applicationId: rakutenId, accessKey: rakutenKey, affiliateId: nonEmpty(env.RAKUTEN_AFFILIATE_ID) }
        : null,
    limits: {
      searchesPerProviderPerItem: 2,
      // 楽天の規約により、メモリ上の短時間(最大 1 時間)に限る。
      cacheTtlMs: Math.min(positiveNumber(env.SEARCH_CACHE_TTL_SECONDS) ?? MAX_CACHE_TTL_SECONDS, MAX_CACHE_TTL_SECONDS) * 1000,
      identifyPerInstallPerDay: perInstall,
      identifyPerIpPerDay: perInstall * 3,
      serpapiMonthly: positiveNumber(env.SERPAPI_MONTHLY_LIMIT) ?? 200,
      searchTimeoutMs: 15_000,
    },
    serpapiCostPerSearchUsd: positiveNumber(env.SERPAPI_COST_PER_SEARCH_USD),
    usageFile: nonEmpty(env.USAGE_FILE) ?? 'data/usage.json',
  };
}
