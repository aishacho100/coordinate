import type { FontKey } from '@coordinate/layout';

/** テンプレートの論理フォント名 → 実際に読み込んだフォントファミリー名。 */
export const FONT_FAMILY: Record<FontKey, string> = {
  mincho: 'ShipporiMincho_500Medium',
  gothic: 'ZenKakuGothicNew_500Medium',
  gothicBold: 'ZenKakuGothicNew_700Bold',
  latin: 'CormorantGaramond_600SemiBold',
  hand: 'KleeOne_600SemiBold',
};

export const FONT_LABEL_JA: Record<FontKey, string> = {
  mincho: '明朝',
  gothic: 'ゴシック',
  gothicBold: '太ゴシック',
  latin: '欧文セリフ',
  hand: '手書き',
};
