import { withAlpha } from '@/lib/color';

describe('withAlpha', () => {
  it('#RRGGBB と #RGB を rgba に変換する', () => {
    expect(withAlpha('#FFFFFF', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#0f0', 1)).toBe('rgba(0, 255, 0, 1)');
  });
  it('不透明度は 0〜1 に丸める', () => {
    expect(withAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
  });
  it('解釈できない色はそのまま返す', () => {
    expect(withAlpha('transparent', 0.5)).toBe('transparent');
  });
});
