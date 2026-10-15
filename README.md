# Coordinate

コーデ写真から服・靴・バッグ・アクセサリーを AI で認識し、ブランド名・商品名・価格を配置した SNS 投稿用画像を作る iOS / Android アプリ。

> **現在のステータス: Phase 2(画像編集の基本機能)完了。**
> 写真を選んで、ラベル・線・矢印を手動で配置し、画像として書き出し・共有できます。
> **AI によるアイテム認識・商品特定は未実装です。**(画面にも「準備中」と表示されます)
> 既知の制約は [docs/limitations.md](docs/limitations.md) を参照。

## できること(Phase 2)

- OS 標準の写真ピッカーで1枚選ぶ(写真ライブラリ全体の権限は要求しない)
- 縦横比(4:5 / 1:1 / 9:16 / 元の比率)、トリミング位置の調整、90°回転
- ラベル(ブランド名・商品名・価格)の追加・ドラッグ移動・文字/色/サイズ/フォント/背景の編集
- ラベルからアイテムへ伸びる線・矢印(なし/矢印/曲線矢印/丸)。線の指し先もドラッグで移動
- テンプレート6種(ミニマル / 雑誌風 / 手書き風 / ラグジュアリー / ストリート / 商品解説風)
- 価格の表示/非表示(全体・ラベル単位)、ブランド名・商品名の個別オン/オフ
- 元に戻す / やり直す、配置を自動に戻す
- PNG/JPEG 書き出し(幅 1080px)、OS 標準の共有、端末への保存

## 構成

```
apps/mobile/       Expo (SDK 57) + TypeScript + Expo Router
packages/shared/   共通の型と zod スキーマ(アイテム、確度、商品、編集データ)
packages/layout/   純粋ロジック: テンプレート定義、編集操作、履歴、トリミング、線の幾何
apps/api/          (Phase 3 で追加) 解析・商品検索 API
eval/              (Phase 5 で追加) 評価データと評価スクリプト
docs/              設計ドキュメント(順次追加)
```

編集データ(`EditDocument`)は写真と分離した JSON で、テンプレート定義(`TemplateDefinition`)とも分離している。

## 必要環境

- Node.js 22 以上、npm 11
- Android 確認: Android Studio の SDK(`ANDROID_HOME` を設定)とエミュレータ、JDK 21
- iOS 確認: macOS + Xcode、または実機の Expo Go(Windows ではビルド不可)

## セットアップと起動

```bash
npm install
cp .env.example .env        # 値を設定(.env は Git 管理外)
cd apps/mobile
npx expo start --android    # エミュレータ起動済みの状態で実行。Expo Go が自動導入される
```

### Expo Go の制約

Expo Go ではほとんどの機能を試せますが、**「端末に保存」は使えません**(`expo-media-library` のネイティブ部分が含まれないため)。
共有から保存するよう案内が表示されます。保存まで試すには開発ビルドを使います。

```bash
cd apps/mobile
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"   # 環境に合わせて
npx expo run:android          # 初回は Gradle のダウンロードで時間がかかる
```

## 検証コマンド

```bash
npm run typecheck   # 全ワークスペースの型検査
npm run lint        # apps/mobile の lint
npm test            # 全ワークスペースのテスト
cd apps/mobile && npx expo-doctor
```

## 注意事項

- `react` は monorepo 全体で 19.2.3 に固定している(ルート `package.json` の `overrides` と `devDependencies`)。React Native の要求バージョンと食い違うと、ネイティブビルドで問題が出る。
- `expo install` は Windows で npm の起動に失敗することがある。その場合は `npm install -w mobile <package>@<SDK対応版>` を使う(対応版は `node_modules/expo/bundledNativeModules.json` に載っている)。
- `@testing-library/react-native` は v13 を使う(v14 は react 19.3 を要求し、React Native 0.86 の 19.2.3 と合わない)。
- 秘密情報は `EXPO_PUBLIC_` 変数に入れない。API キーは `apps/api` のサーバー側のみで管理する。
- `app.json` のパッケージ ID(`com.example.coordinate`)は仮の値。リリース前に変更する。
- フォントは Google Fonts(OFL): Shippori Mincho / Zen Kaku Gothic New / Cormorant Garamond / Klee One。

## ロードマップ

Phase 1 基盤(完了) → 2 画像編集(完了) → 3 AI 検出 → 4 商品特定 → 5 精度改善基盤 → 6 セキュリティ → 7 仕上げ。
