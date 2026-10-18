import { isAllowedImageUrl } from './image-url';

describe('isAllowedImageUrl', () => {
  it('Google のサムネイルと楽天の画像だけを許可する', () => {
    expect(isAllowedImageUrl('https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc')).toBe(true);
    expect(isAllowedImageUrl('https://thumbnail.image.rakuten.co.jp/@0_mall/a/b.jpg?_ex=128x128')).toBe(true);
  });
  it('http・他のドメイン・内部アドレス・不正な URL は拒否する', () => {
    expect(isAllowedImageUrl('http://encrypted-tbn0.gstatic.com/x')).toBe(false);
    expect(isAllowedImageUrl('https://evil.example.com/x.jpg')).toBe(false);
    expect(isAllowedImageUrl('https://gstatic.com.evil.example/x')).toBe(false);
    expect(isAllowedImageUrl('https://127.0.0.1/x')).toBe(false);
    expect(isAllowedImageUrl('not a url')).toBe(false);
  });
});
