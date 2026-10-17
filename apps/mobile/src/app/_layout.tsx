import {
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import { ShipporiMincho_500Medium, ShipporiMincho_700Bold } from '@expo-google-fonts/shippori-mincho';
import {
  ZenKakuGothicNew_400Regular,
  ZenKakuGothicNew_500Medium,
  ZenKakuGothicNew_700Bold,
} from '@expo-google-fonts/zen-kaku-gothic-new';
import { KleeOne_600SemiBold } from '@expo-google-fonts/klee-one';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors, Fonts } from '@/constants/theme';
import { AnalysisProvider } from '@/features/analysis/analysis-context';
import { EditorProvider } from '@/features/editor/editor-context';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[scheme];

  const [fontsLoaded, fontError] = useFonts({
    ShipporiMincho_500Medium,
    ShipporiMincho_700Bold,
    ZenKakuGothicNew_400Regular,
    ZenKakuGothicNew_500Medium,
    ZenKakuGothicNew_700Bold,
    CormorantGaramond_600SemiBold,
    CormorantGaramond_500Medium_Italic,
    KleeOne_600SemiBold,
  });

  useEffect(() => {
    // フォント読み込みに失敗してもアプリは使えるようにする(システムフォントで代替)。
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <EditorProvider>
        <AnalysisProvider>
        <ThemeProvider value={navTheme}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerTitleAlign: 'center',
              headerTitleStyle: { fontFamily: Fonts.serif, fontSize: 17, color: colors.text },
              headerBackButtonDisplayMode: 'minimal',
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.background },
            }}>
            <Stack.Screen name="index" options={{ title: 'COORDINATE' }} />
            <Stack.Screen name="analyzing" options={{ title: 'AI解析中' }} />
            <Stack.Screen name="result" options={{ title: '認識結果' }} />
            <Stack.Screen name="editor" options={{ title: '画像編集' }} />
            <Stack.Screen name="export" options={{ title: '書き出し' }} />
            <Stack.Screen name="settings" options={{ title: '設定・プライバシー' }} />
          </Stack>
        </ThemeProvider>
        </AnalysisProvider>
      </EditorProvider>
    </GestureHandlerRootView>
  );
}
