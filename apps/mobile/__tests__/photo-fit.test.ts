import { fitPhoto } from '@/features/analysis/photo-fit';

describe('fitPhoto', () => {
  it('縦長の写真は高さの上限に合わせて幅を狭め、アスペクトを保つ', () => {
    const r = fitPhoto({ width: 3000, height: 4000 }, 345, 380);
    expect(r.height).toBeCloseTo(380);
    expect(r.width).toBeCloseTo(285);
    expect(r.width / r.height).toBeCloseTo(0.75);
  });

  it('上限に収まる写真は幅いっぱいに広げる', () => {
    const r = fitPhoto({ width: 4000, height: 3000 }, 345, 380);
    expect(r.width).toBeCloseTo(345);
    expect(r.height).toBeCloseTo(258.75);
  });
});
