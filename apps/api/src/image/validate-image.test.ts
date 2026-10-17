import { checkerJpeg, flatPng } from '../test-utils';
import { validateImage } from './validate-image';

describe('validateImage', () => {
  it('JPEG を受け入れる', async () => {
    expect(validateImage(await checkerJpeg(64, 64))).toEqual({ ok: true, mediaType: 'image/jpeg' });
  });

  it('PNG を受け入れる', async () => {
    expect(validateImage(await flatPng(8, 8, 100))).toEqual({ ok: true, mediaType: 'image/png' });
  });

  it('画像でないデータ・空データ・GIF を拒否する', () => {
    expect(validateImage(Buffer.from('hello world'))).toEqual({ ok: false });
    expect(validateImage(Buffer.alloc(0))).toEqual({ ok: false });
    expect(validateImage(Buffer.from('GIF89a......'))).toEqual({ ok: false });
  });
});
