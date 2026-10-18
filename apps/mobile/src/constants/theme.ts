import '@/global.css';

/**
 * 配色: ダーク固定(ダーク・ギャラリー)。端末のライト/ダーク設定は無視する。
 * 金(accent)は「いま押すもの」だけに使う。
 */
export const Colors = {
  text: '#F4F1EC',
  background: '#0F0E0D',
  backgroundElement: '#1D1B19',
  backgroundSelected: '#2B2926',
  textSecondary: '#9B9388',
  border: '#2B2926',
  accent: '#C9B38A',
  /** 金の上に載せる文字・アイコンの色。 */
  onAccent: '#0F0E0D',
  error: '#D98B7E',
  success: '#9CBFA5',
} as const;

export type ThemeColor = keyof typeof Colors;

/**
 * フォント(すべて OFL)。
 * - serif: Shippori Mincho(見出し。和文の明朝)
 * - sans: Zen Kaku Gothic New(本文。細身で端正なゴシック)
 * - latin: Cormorant Garamond(欧文のアクセント)
 */
export const Fonts = {
  serif: 'ShipporiMincho_500Medium',
  serifBold: 'ShipporiMincho_700Bold',
  sans: 'ZenKakuGothicNew_400Regular',
  sansMedium: 'ZenKakuGothicNew_500Medium',
  sansBold: 'ZenKakuGothicNew_700Bold',
  latin: 'CormorantGaramond_600SemiBold',
  latinItalic: 'CormorantGaramond_500Medium_Italic',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
/** ボタンなどの読みやすい最大幅。画面いっぱいに広げない。 */
export const ButtonMaxWidth = 280;
