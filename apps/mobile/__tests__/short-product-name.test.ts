import { shortProductName } from '@/features/analysis/short-product-name';

describe('shortProductName', () => {
  it('先頭の【店名】と販促語を除き、型番を末尾に残す', () => {
    expect(
      shortProductName('【楽天市場】ナイキ エアフォース1 メンズ CJ4864-657 送料無料 ポイントUP', 'NIKE'),
    ).toBe('ナイキ エアフォース1 CJ4864-657');
  });

  it('販促・性別・状態の定型語を除く', () => {
    const r = shortProductName('【公式】新品 メンズ クラブ フーディー 送料無料 クーポン配布中', 'NIKE');
    expect(r).toBe('クラブ フーディー');
  });

  it('先頭の [..] と (..) も除く', () => {
    expect(shortProductName('[国内正規品] (即納) サンバ OG', 'adidas')).toBe('サンバ OG');
  });

  it('区切りで最初の意味のある区間だけを使う', () => {
    expect(shortProductName('サンバ OG | アディダス 公式ストア', '')).toBe('サンバ OG');
    expect(shortProductName(' | / サンバ OG / スニーカー', '')).toBe('サンバ OG');
    expect(shortProductName('Samba OG - adidas Japan', '')).toBe('Samba OG');
  });

  it('ブランド名の重複を大文字小文字を問わず除く', () => {
    expect(shortProductName('NIKE Air Force 1 07', 'nike')).toBe('Air Force 1 07');
  });

  it('型番内のハイフンでは区切らない', () => {
    expect(shortProductName('Dunk Low FV5029-100', 'NIKE')).toBe('Dunk Low FV5029-100');
  });

  it('24 文字を超えたら … で切り、型番は残す', () => {
    const r = shortProductName('エアマックス ダンク ローカット ハイプレミアム エディション FV5029-100', '');
    expect(r.length).toBeLessThanOrEqual(24);
    expect(r).toContain('…');
    expect(r.endsWith('FV5029-100')).toBe(true);
    const long = shortProductName('あいうえおかきくけこさしすせそたちつてとなにぬねの', '');
    expect(long).toHaveLength(24);
    expect(long.endsWith('…')).toBe(true);
  });

  it('結果が空なら fallback を返す', () => {
    expect(shortProductName('【楽天市場】送料無料', 'NIKE', 'スニーカー')).toBe('スニーカー');
    expect(shortProductName('', '')).toBe('');
  });
});
