import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'display' | 'title' | 'subtitle' | 'small' | 'smallBold' | 'eyebrow';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  /** 画面の主見出し。明朝で大きく、字間を少し詰める。 */
  display: {
    fontFamily: Fonts.serif,
    fontSize: 34,
    lineHeight: 50,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 38,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: Fonts.serifBold,
    fontSize: 18,
    lineHeight: 28,
    letterSpacing: 0.4,
  },
  default: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 27,
    letterSpacing: 0.4,
  },
  small: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 22,
    letterSpacing: 0.3,
  },
  smallBold: {
    fontFamily: Fonts.sansBold,
    fontSize: 13,
    lineHeight: 22,
    letterSpacing: 0.3,
  },
  /** 欧文の小見出し(例: STEP 01)。 */
  eyebrow: {
    fontFamily: Fonts.latin,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
