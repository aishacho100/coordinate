import { isAllowedImageUrl } from './image-url';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
export type FetchedImage = { data: Uint8Array; mediaType: ImageMediaType };

export type ImageFetchLike = (
  url: string,
  init: { signal?: AbortSignal; redirect?: 'error' | 'follow' | 'manual' },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type FetchImageOpts = {
  fetchImpl: ImageFetchLike;
  timeoutMs?: number;
  maxBytes?: number;
};

const TYPES: readonly ImageMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * 候補の画像をサーバーが取得する(Claude に URL を渡すと、取得側の robots.txt で拒否されうるため)。
 * 許可された https URL のみ・リダイレクトなし・タイムアウトとサイズ上限つき。失敗は null。
 */
export async function fetchImage(url: string, opts: FetchImageOpts): Promise<FetchedImage | null> {
  if (!isAllowedImageUrl(url)) return null;
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await opts.fetchImpl(new URL(url).href, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const mediaType = TYPES.find((t) => t === type);
    if (!mediaType) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return { data: new Uint8Array(buf), mediaType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
