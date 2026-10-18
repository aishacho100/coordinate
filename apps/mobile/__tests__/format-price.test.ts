import { formatAsOf, formatPrice } from '@/lib/format-price';

describe('formatPrice', () => {
  it('JPY は「¥」と 3 桁区切り', () => {
    expect(formatPrice(7590, 'JPY')).toBe('¥7,590');
    expect(formatPrice(1234567, 'JPY')).toBe('¥1,234,567');
    expect(formatPrice(0, 'JPY')).toBe('¥0');
  });
  it('JPY の小数は四捨五入する', () => {
    expect(formatPrice(7590.4, 'JPY')).toBe('¥7,590');
  });
  it('JPY 以外は金額の後ろに通貨コードを付ける', () => {
    expect(formatPrice(1234.5, 'USD')).toBe('1,234.5 USD');
    expect(formatPrice(80, 'EUR')).toBe('80 EUR');
  });
});

describe('formatAsOf', () => {
  it('「○月○日時点」にする(日本時間で数える)', () => {
    expect(formatAsOf('2026-10-18T00:00:00.000Z')).toBe('10月18日時点');
    expect(formatAsOf('2026-01-05T03:00:00.000Z')).toBe('1月5日時点');
  });
  it('日本時間では翌日になる時刻は翌日として数える', () => {
    expect(formatAsOf('2026-10-17T15:30:00.000Z')).toBe('10月18日時点');
  });
  it('日時として読めなければ空文字', () => {
    expect(formatAsOf('not a date')).toBe('');
  });
});
