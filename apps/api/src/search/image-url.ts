const HOSTS = [/^encrypted-tbn\d\.gstatic\.com$/, /^thumbnail\.image\.rakuten\.co\.jp$/];

/** 候補の画像 URL を Claude に渡してよいか。https かつ許可ドメインのみ。 */
export function isAllowedImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  // ポート・ユーザー情報つきの URL は拒否する。
  if (u.port !== '' || u.username !== '' || u.password !== '') return false;
  return u.protocol === 'https:' && HOSTS.some((re) => re.test(u.hostname));
}
