import { useRouter } from 'expo-router';

import { AppButton } from '@/components/app-button';
import { NotImplemented } from '@/components/not-implemented';
import { Screen } from '@/components/screen';

export default function AnalyzingScreen() {
  const router = useRouter();
  return (
    <Screen>
      <NotImplemented phase={3} description="段階表示(品質評価→検出→切り抜き→特徴抽出)と失敗時の再試行は Phase 3 で実装します。" />
      <AppButton label="認識結果へ(骨組み)" onPress={() => router.push('/result')} />
    </Screen>
  );
}
