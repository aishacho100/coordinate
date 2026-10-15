# 進捗と再開メモ

最終更新: Phase 2 完了直後(開発ビルドの動作確認だけ未了)。

## 現在地

- Phase 1(基盤)完了、Phase 2(画像編集)完了。**次は Phase 3(AI アイテム検出)**。
- Git: `git init` 済みだが**コミットはまだ無い**。再開時に、区切りとして最初のコミットをするか確認する。
- テスト: shared 3 / layout 41 / mobile 38、すべて成功。型検査・lint・`expo-doctor` もエラーなし。

## 未完了の確認(再開時の最初の作業)

**開発ビルドでの「端末に保存」の確認。** Expo Go ではネイティブ部分が無く保存できないため。

```bash
cd apps/mobile
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
npx expo run:android --no-bundler     # Metro は別途 npx expo start で起動しておく
```

- 前回は Gradle ビルド中に中断した(初回は時間がかかる)。ビルド中に Gradle が Android SDK へ NDK 27.1.12297006 と Build-Tools 36 を自動導入した(ビルドに必要。完了・成否は未確認)。`apps/mobile/android/` は prebuild の生成物で Git 管理外。
- 確認項目: 保存の権限ダイアログ → 保存成功 → 端末のギャラリーに画像がある → 拒否時のメッセージ。
- 失敗した場合は `app.json` の `expo-media-library` プラグイン設定(`granularPermissions: []`)を疑う。

## 環境の起動手順(エミュレータ)

```bash
# エミュレータ(AVD: Pixel_7_API_35)
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd Pixel_7_API_35 -no-audio
# 開発サーバー + Expo Go(エミュレータ起動後)
cd apps/mobile && npx expo start --android
```

- `-no-snapshot-save` を付けて終了すると Expo Go が消える。付けない。
- 初回起動時は Expo Go の開発者メニューが画面を覆う。「Continue」→ 右上の × で閉じる。
- アプリ内でのテスト写真は `/sdcard/Pictures/outfit_test.jpg`(合成画像。消えていたら再生成して `adb push`)。
- Git Bash で `adb shell` に `/sdcard/...` を渡すときは `export MSYS_NO_PATHCONV=1` が必要。

## 決定済みの方針(変更する場合はユーザーに確認)

- バックエンド: Fastify を `apps/api` に置く。デプロイはユーザーの承認後。
- AI: Phase 3 は Anthropic の Vision API を `Detector` の実装の1つとして使う。キーは `apps/api/.env`(Git 管理外)。チャットに貼らない。ユーザーは API キーを取得済み。
- 商品カタログ: `CatalogProvider` のインターフェースと、明示的に「テスト用」と表示するローカルカタログから始める。楽天 API 等の接続はキー用意後。
- ダミー商品を実在商品として表示しない。モックの成功を実際の AI 解析の成功として報告しない。
- デザイン: 温かいオフホワイト+インク色。見出しは明朝(Shippori Mincho)、本文はゴシック(Zen Kaku Gothic New)、欧文は Cormorant Garamond、手書きは Klee One。ボタンは最大幅 280px の中央配置(全幅にしない)。ユーザーはこの見た目を承認済み。

## 判明している注意点

- `react` は 19.2.3 固定(ルートの `overrides` と `devDependencies`)。外すと 19.3 が混入する。
- RNTL は v13(v14 は react 19.3 を要求)。
- `expo install` は Windows で失敗する。`npm install -w mobile pkg@<bundledNativeModules の版>` を使う。
- `expo-media-library` は Expo Go に無いので、`require` の前に `requireOptionalNativeModule` で確認している(`export-image.ts`)。
- jest-expo では動的 `import()` が使えない。
- ジェスチャーのコールバックで ref を読むと lint(react-hooks/refs)に落ちる。ドラッグは差分アクションで reducer に渡す方式。

## Phase 2 で見えている改善点(Phase 7 で対応予定)

- 編集画面の下部パネルが狭い(キャンバスが画面の約45%)。テンプレート一覧のカードが切れて見える。
- 下書き保存、最近作成した画像の一覧は未実装。
- 実写真での見た目の確認が未了(合成画像のみ)。

## Phase 3 の着手前に決めること

1. `apps/api` の構成(Fastify、zod、環境変数の読み込み、レート制限の入口)
2. `Detector` / `Embedder` / `CatalogProvider` / `Reranker` のインターフェース(`packages/shared` に型を追加)
3. 写真品質評価をクライアント側かサーバー側のどちらで行うか
4. Anthropic モデルの選定(コスト・精度の比較。実測してから決める)
