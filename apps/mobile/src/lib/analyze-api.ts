import { AnalyzeResponseSchema, ApiErrorSchema, type AnalyzeResponse, type ApiErrorCode } from '@coordinate/shared';
import { File } from 'expo-file-system';

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
  // Expo ではグローバル fetch が expo/fetch に置き換わっており、React Native 形式の
  // { uri, name, type } は「Unsupported FormDataPart implementation」で失敗する。
  // Blob を実装する expo-file-system の File を添付する。
  form.append('image', new File(uri));

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
