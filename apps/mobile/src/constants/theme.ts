import '@/global.css';

/**
 * 配色: 温かみのあるオフホワイトとインク。ファッション誌のような抑えたトーン。
 */
export const Colors = {
  light: {
    text: '#1B1A19',
    background: '#FAF8F5',
    backgroundElement: '#F1EDE7',
    backgroundSelected: '#E5DFD6',
    textSecondary: '#7B746B',
    border: '#DDD6CC',
  },
  dark: {
    text: '#F4F1EC',
    background: '#121110',
    backgroundElement: '#1D1C1A',
    backgroundSelected: '#2B2926',
    textSecondary: '#A59E94',
    border: '#34312D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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
