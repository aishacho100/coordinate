import type { Product, SearchStatus } from '@coordinate/shared';

export type SearchOutcome = {
  status: SearchStatus;
  products: Product[];
  /** 実際に外部へ送った回数(キャッシュの命中は含めない)。 */
  calls: number;
  /** status が failed のときの理由の種類(http_429・timeout・network・parse)。キー・URL・検索語は含めない。 */
  detail?: string;
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
