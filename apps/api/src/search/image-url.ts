/** 許可する画像: 楽天のサムネイルと、SerpApi が配る /images/url/ のサムネイル。gstatic は robots.txt で拒否されるため使わない。 */
const RAKUTEN_HOST = 'thumbnail.image.rakuten.co.jp';
const SERPAPI_HOST = 'serpapi.com';
const SERPAPI_PATH = '/images/url/';

/** 候補の画像 URL をサーバーから取得してよいか。https かつ許可ドメインのみ。 */
export function isAllowedImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  // ポート・ユーザー情報つきの URL は拒否する。
  if (u.port !== '' || u.username !== '' || u.password !== '') return false;
  if (u.protocol !== 'https:') return false;
  if (u.hostname === RAKUTEN_HOST) return true;
  return u.hostname === SERPAPI_HOST && u.pathname.startsWith(SERPAPI_PATH);
}

/** 商品ページの URL として使えるか(https のみ)。http や javascript: は使わない。 */
export function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}
