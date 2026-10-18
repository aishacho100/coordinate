import { isAllowedImageUrl, isAllowedLensThumbnailUrl } from './image-url';

describe('isAllowedLensThumbnailUrl / Lens のサムネイル', () => {
  const ok = 'https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcTJqSqK0nkBVwCjp-4C0lhQGpB0t23-S51z0dWXTVddHckmEDqI';
  it('encrypted-tbn0〜3.gstatic.com の /images?q=tbn: だけを許可する', () => {
    for (const n of [0, 1, 2, 3]) {
      const u = `https://encrypted-tbn${n}.gstatic.com/images?q=tbn:abc`;
      expect(isAllowedLensThumbnailUrl(u)).toBe(true);
      expect(isAllowedImageUrl(u)).toBe(true); // fetchImage の許可にも含まれる
    }
    expect(isAllowedLensThumbnailUrl(ok)).toBe(true);
  });
  it('別のパス・別のホスト・http・ポート・ユーザー情報は拒否する', () => {
    const ng = [
      'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc',
      'https://encrypted-tbn0.gstatic.com/images?id=abc',
      'https://encrypted-tbn9.gstatic.com/images?q=tbn:abc',
      'https://encrypted-tbn0.gstatic.com.evil.example/images?q=tbn:abc',
      'https://www.gstatic.com/images?q=tbn:abc',
      'http://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
      'https://encrypted-tbn0.gstatic.com:8443/images?q=tbn:abc',
      'https://u@encrypted-tbn0.gstatic.com/images?q=tbn:abc',
      'not a url',
    ];
    for (const u of ng) {
      expect(isAllowedLensThumbnailUrl(u)).toBe(false);
      expect(isAllowedImageUrl(u)).toBe(false);
    }
  });
});

describe('isAllowedImageUrl', () => {
  it('SerpApi の /images/url/ と楽天の画像だけを許可する', () => {
    expect(isAllowedImageUrl('https://serpapi.com/images/url/abc123.webp')).toBe(true);
    expect(isAllowedImageUrl('https://serpapi.com/search.json?x=1')).toBe(false);
    expect(isAllowedImageUrl('https://serpapi.com/images/other/a.webp')).toBe(false);
    expect(isAllowedImageUrl('https://serpapi.com/images/urlx/a.webp')).toBe(false);
    expect(isAllowedImageUrl('http://serpapi.com/images/url/a.webp')).toBe(false);
    // Shopping の gstatic(/shopping)は引き続き使わない。Lens 用の /images だけ別に許可している。
    expect(isAllowedImageUrl('https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc')).toBe(false);
    expect(isAllowedImageUrl('https://thumbnail.image.rakuten.co.jp/@0_mall/a/b.jpg?_ex=128x128')).toBe(true);
  });
  it('http・他のドメイン・内部アドレス・不正な URL は拒否する', () => {
    expect(isAllowedImageUrl('http://encrypted-tbn0.gstatic.com/x')).toBe(false);
    expect(isAllowedImageUrl('https://evil.example.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://gstatic.com.evil.example/x')).toBe(false);
    expect(isAllowedImageUrl('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedImageUrl('not a url')).toBe(false);
  });
  it('ポート指定・ユーザー情報つきの URL は拒否する', () => {
    expect(isAllowedImageUrl('https://thumbnail.image.rakuten.co.jp:8443/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://user@thumbnail.image.rakuten.co.jp/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://user:pass@thumbnail.image.rakuten.co.jp/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://:pass@thumbnail.image.rakuten.co.jp/a.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://thumbnail.image.rakuten.co.jp:443/a.jpg')).toBe(true);
  });
});
