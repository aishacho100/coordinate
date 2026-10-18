/**
 * 許可する画像: 楽天のサムネイルと、SerpApi が配る /images/url/ のサムネイル、Google Lens のサムネイル。
 * Google Shopping の gstatic(/shopping)は robots.txt で拒否されるため使わない。
 * Lens の結果には SerpApi のプロキシ版が無く、サムネイルは encrypted-tbn*.gstatic.com/images だけなので、Lens 用に限って許可する。
 */
const RAKUTEN_HOST = 'thumbnail.image.rakuten.co.jp';
const SERPAPI_HOST = 'serpapi.com';
const SERPAPI_PATH = '/images/url/';
const LENS_THUMB_HOST = /^encrypted-tbn[0-3]\.gstatic\.com$/;
const LENS_THUMB_PATH = '/images';

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
  if (u.hostname === SERPAPI_HOST && u.pathname.startsWith(SERPAPI_PATH)) return true;
  return isLensThumbnail(u);
}

function isLensThumbnail(u: URL): boolean {
  return (
    u.protocol === 'https:' &&
    u.port === '' &&
    u.username === '' &&
    u.password === '' &&
    LENS_THUMB_HOST.test(u.hostname) &&
    u.pathname === LENS_THUMB_PATH &&
    (u.searchParams.get('q') ?? '').startsWith('tbn:')
  );
}

/** Google Lens の結果のサムネイル(encrypted-tbn0〜3.gstatic.com/images?q=tbn:…)か。 */
export function isAllowedLensThumbnailUrl(raw: string): boolean {
  try {
    return isLensThumbnail(new URL(raw));
  } catch {
    return false;
  }
}

/** 商品ページの URL として使えるか(https のみ)。http や javascript: は使わない。 */
export function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}
