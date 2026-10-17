export type ImageValidation = { ok: true; mediaType: 'image/jpeg' | 'image/png' } | { ok: false };

/** 宣言された Content-Type ではなく、先頭バイトで形式を判定する。 */
export function validateImage(data: Uint8Array): ImageValidation {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ok: true, mediaType: 'image/jpeg' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((b, i) => data[i] === b)) {
    return { ok: true, mediaType: 'image/png' };
  }
  return { ok: false };
}
