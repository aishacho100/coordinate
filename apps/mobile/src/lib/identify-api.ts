import { ApiErrorSchema, IdentifyResponseSchema, type DetectedItem, type IdentifyResponse } from '@coordinate/shared';
import { File } from 'expo-file-system';

import { AnalyzeError } from './analyze-api';
import { getInstallId } from './install-id';

type Options = { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; installId?: string;
  /** 画像検索(Lens)への同意。true のときだけ x-image-search-consent を付ける。 */
  imageSearchConsent?: boolean;
};

/** 切り抜き画像 1 枚と、そのアイテムの検出結果を送り、商品の候補と判定を受け取る。 */
export async function identifyItem(cropUri: string, item: DetectedItem, options: Options = {}): Promise<IdentifyResponse> {
  const baseUrl = options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new AnalyzeError('not_configured');
  const doFetch = options.fetchImpl ?? fetch;
  const installId = options.installId ?? (await getInstallId());

  const form = new FormData();
  form.append('item', JSON.stringify(item));
  // Expo の fetch は RN 形式の { uri } を受け付けない。Blob を実装する expo-file-system の File を使う。
  form.append('image', new File(cropUri));

  const headers: Record<string, string> = { 'x-install-id': installId };
  if (options.imageSearchConsent === true) headers['x-image-search-consent'] = '1';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await doFetch(`${baseUrl.replace(/\/$/, '')}/v1/identify`, {
      method: 'POST',
      headers,
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
    throw new AnalyzeError('identify_failed');
  }
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(body);
    throw new AnalyzeError(err.success ? err.data.error : 'identify_failed');
  }
  const parsed = IdentifyResponseSchema.safeParse(body);
  if (!parsed.success) throw new AnalyzeError('identify_failed');
  return parsed.data;
}
