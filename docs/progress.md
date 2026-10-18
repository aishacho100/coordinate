# 進捗と再開メモ

最終更新: Phase 4(商品特定)の実装と実 API の評価が完了。エミュレータ確認は未実施。UI 刷新は手順 3 作業中。

## 現在地

- Phase 1(基盤)、Phase 2(画像編集)、Phase 3(AI アイテム検出)完了。**次は Phase 4(商品特定)**。着手前に必要なことは下の「次: Phase 4」を参照。
- Phase 4(商品特定)の実装(api の `/v1/identify`、SerpApi・楽天の検索、Claude の照合、モバイルの「商品を探す」)はブランチ `phase4-identification` で完了。実 API の評価は実施済み(結果は `docs/phase4-evaluation.md`)。**エミュレータでの通し確認は未実施**。
- Git: Phase 3 はブランチ `phase3-detection`、Phase 4 は `phase4-identification` で作業(いずれも main へは未マージ)。
- テスト: api 161 / mobile 110 / layout 43 / shared 14、すべて成功(`npm test`)。型検査(`npm run typecheck`)・lint(`npm run lint`)もエラーなし。

## 開発ビルドでの保存確認(完了)

- 開発ビルド(`expo run:android`)は成功。「端末に保存」で 1080×1350 の PNG が `DCIM/` に保存され、MediaStore で確認できた。
- Android 10 以降は書き込み専用なら実行時権限が不要で、権限ダイアログは出ない(仕様どおり)。拒否時のメッセージはこの端末では到達しない。
- 開発ビルドはエミュレータに導入済み。Metro は `npx expo start`、`adb reverse tcp:8081 tcp:8081` の後に `coordinate://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081` を開く。

## 環境の起動手順(エミュレータ)

```bash
# エミュレータ(AVD: Pixel_7_API_35)
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd Pixel_7_API_35 -no-audio
# 開発サーバー + Expo Go(エミュレータ起動後)
cd apps/mobile && npx expo start --android
```

- `-no-snapshot-save` を付けて終了すると Expo Go が消える。付けない。
- Git Bash から `emulator.exe` を直接起動すると segfault する。PowerShell の `Start-Process` で起動する。
- ビルド直後はエミュレータが極端に重く、画面が黒いまま数分かかることがある。スナップショット復元で黒画面が固定されたら `-no-snapshot-load` でコールドブートする。
- 初回起動時は Expo Go の開発者メニューが画面を覆う。「Continue」→ 右上の × で閉じる。
- アプリ内でのテスト写真は `/sdcard/Pictures/outfit_test.jpg`(合成画像。消えていたら再生成して `adb push`)。
- Git Bash で `adb shell` に `/sdcard/...` を渡すときは `export MSYS_NO_PATHCONV=1` が必要。

## 決定済みの方針(変更する場合はユーザーに確認)

- バックエンド: Fastify を `apps/api` に置く。デプロイはユーザーの承認後。
- AI: Phase 3 は Anthropic の Vision API を `Detector` の実装の1つとして使う。キーは `apps/api/.env`(Git 管理外)。チャットに貼らない。ユーザーは API キーを取得済み。
- 商品特定は Phase 4 で、SerpApi と楽天市場 API を使って行う。要件は `docs/product-identification-requirements.md`。Phase 3 では商品を出さない(テスト用ローカルカタログは作らない)。Phase 4 の前に、公式ドキュメント・料金・規約の調査と報告、SerpApi キー、楽天のアプリ登録が必要。
- ダミー商品を実在商品として表示しない。モックの成功を実際の AI 解析の成功として報告しない。
- デザイン: 温かいオフホワイト+インク色。見出しは明朝(Shippori Mincho)、本文はゴシック(Zen Kaku Gothic New)、欧文は Cormorant Garamond、手書きは Klee One。ボタンは最大幅 280px の中央配置(全幅にしない)。ユーザーはこの見た目を承認済み。

## 判明している注意点

- `react` は 19.2.3 固定(ルートの `overrides` と `devDependencies`)。外すと 19.3 が混入する。
- RNTL は v13(v14 は react 19.3 を要求)。
- `expo install` は Windows で失敗する。`npm install -w mobile pkg@<bundledNativeModules の版>` を使う。
- `expo-media-library` は Expo Go に無いので、`require` の前に `requireOptionalNativeModule` で確認している(`export-image.ts`)。
- jest-expo では動的 `import()` が使えない。
- ジェスチャーのコールバックで ref を読むと lint(react-hooks/refs)に落ちる。ドラッグは差分アクションで reducer に渡す方式。
- Expo SDK 57 ではグローバル `fetch` が `expo/fetch`。`FormData` にファイルを入れるときは React Native 形式の `{ uri, name, type }` ではなく、`expo-file-system` の `File` を使う(`analyze-api.ts`)。
- Windows の Git Bash で `timeout` を使ってサーバーを起動すると、子プロセス(node)が残ることがある。止めるときはポート(`netstat -ano | grep :8787`)から PID を特定して `taskkill` する。
- `apps/api` の jest: fastify の light-my-request が使う `cookie@2` が ESM のみのため、`transformIgnorePatterns` で `cookie` を変換対象に含めている(`apps/api/jest.config.js`)。
- `sharp` の `stats()` は処理前の入力画像を測る。加工後の値が必要なら、いったん `toBuffer()` してから新しい `sharp` で `stats()` する(ぼけ判定の不具合の原因だった)。

## Phase 2 で見えている改善点(Phase 7 で対応予定)

- 編集画面の下部パネルが狭い(キャンバスが画面の約45%)。テンプレート一覧のカードが切れて見える。
- 下書き保存、最近作成した画像の一覧は未実装。
- 実写真での見た目の確認が未了(合成画像のみ)。

## Phase 3(AI アイテム検出)の結果

設計: `docs/superpowers/specs/2026-10-15-phase3-detection-design.md`。実装計画: `docs/superpowers/plans/2026-10-17-phase3-detection.md`(全13タスク、実装済み)。Sonnet 5.5 は `tool_choice` 強制が使えないため、検出はツール呼び出しではなく構造化出力で行う。

### モデル比較と確定モデル

詳細は `docs/phase3-model-comparison.md`。写真 10 枚での実測の要約:

- Sonnet 5.5: 平均約 4.3 秒、1 写真あたり概算約 $0.013。最も安定。
- Haiku 5.5: 平均約 6.5 秒、概算約 $0.001。両足の靴を 1 つの枠にまとめた例あり。出力トークンが多く Sonnet より遅い。
- Opus 5.5(5 枚のみ): 平均約 8.7 秒、概算約 $0.029。人が多い写真で粗いカテゴリを選び、ジーンズを見落とした。
- 推測によるブランドの誤採用は全モデル・全写真でゼロ。
- **既定モデルは Sonnet 5.5(`claude-sonnet-5-5`)に確定**。`apps/api/.env` の `ANTHROPIC_MODEL` で変更できる。

### エミュレータでの確認(実際に Claude を呼んだ結果)

2026-10-17、Pixel_7_API_35 の開発ビルド + ローカルの `apps/api`(Sonnet 5.5)で実施。

- ホーム →「写真を選ぶ」→ 端末内の写真(Nike の赤いパーカーの夜景写真)→「解析しています」→ 認識結果、まで通った。API ログ上の所要は約 7.3 秒(検出 5.2 秒、品質確認 0.8 秒。画面にも表示)。
- 検出は 3 件(パーカー・パンツ・T シャツ)。枠の位置は写真上の各アイテムとおおむね一致。パーカーのブランドは「Nike」(「写真内の文字から読み取りました」と表示)、他は「ブランド不明」。品質の助言は「暗い写真です」「全身が写っていないようです」が表示された。
- adidas のスニーカーの写真では、デニムとスニーカーの 2 件を検出し、スニーカーのブランドは「adidas」(文字から読み取り)。所要は検出 4.1 秒。
- 認識結果画面で、カテゴリ変更(T シャツ → シャツ)、ブランド入力(「入力した内容です」に変わる)、削除、「アイテムを追加」がそれぞれ動いた。
- 「この内容で編集へ」で、ラベルが対応するアイテムの近くに 3 件付いた(手動追加したアイテムは位置情報がないため写真の中央付近)。戻って再度進んでもラベルは 3 件のままで、二重にならなかった。
- 書き出し →「端末に保存」で 1080×1350 の PNG が `DCIM/` に保存された。
- 失敗系: API サーバーを止めて写真を選ぶと「解析できませんでした」「通信できませんでした。…」と「もう一度試す」「手動で編集する」「ホームに戻る」が表示された。「手動で編集する」で編集画面へ進めた。API を再起動した後は、再び解析できた。
- **見つかった不具合(修正済み)**: Expo SDK 57 ではグローバル `fetch` が `expo/fetch` に置き換わっており、React Native 形式の `{ uri, name, type }` を `FormData` に入れると「Unsupported FormDataPart implementation」で送信前に失敗していた(画面上は「通信できませんでした」)。jest ではモックの fetch を使うため検出できなかった。`expo-file-system` の `File`(Blob 互換)を添付する方式に変えて解決。
- 気づいた点(未対応): 認識結果画面で Android の戻るキーを押すと、確認なしでホームに戻り、結果画面での修正が失われる。
- 未確認: iOS、実機、複数人が写る写真のアプリ上での見え方。

### モックでのテスト(実際の Claude は呼ばない)

- api: Claude の応答はモックの Anthropic クライアントで再現(検出結果の検証、ブランドの根拠判定、エラー応答、品質評価など)。
- mobile: 解析 API クライアントは `fetch` を注入してテスト。画面のテストは `analyze-api` をモックしている。ここでの成功は実際の AI 解析の成功を意味しない。

### API サーバーの起動手順(ローカル)

```bash
# apps/api/.env に ANTHROPIC_API_KEY を書く(Git 管理外。チャットに貼らない)
# 任意: ANTHROPIC_MODEL(既定 claude-sonnet-5-5)、ANTHROPIC_EFFORT(既定 medium)、PORT(既定 8787)、
#       RATE_LIMIT_PER_MINUTE(既定 20)、PRICE_INPUT_PER_MTOK / PRICE_OUTPUT_PER_MTOK(費用の概算をログに出す)
npm start -w api          # http://localhost:8787 。/health で確認
# apps/mobile/.env に EXPO_PUBLIC_API_BASE_URL を書く(Git 管理外)
#   Android エミュレータからは http://10.0.2.2:8787(エミュレータから見たホスト PC)
# Metro は起動時にしか .env を読まないので、書き換えたら Metro を再起動する
```

評価スクリプト: `npm run eval -w api`(写真は `apps/api/eval/photos/`、Git 管理外)。
商品特定の評価: `npm run eval:identify -w api -- --max-searches 40 [--photos a,b]`(実 API を呼ぶ。SerpApi は指定回数で止まる。結果は `apps/api/eval/results/identify-<日時>.json`、Git 管理外)。Phase 4 の設定は `.env.example` を参照。

## 次: Phase 4 の残り(評価と実機確認)

実装は完了。実 API の評価は 2026-10-18 に実施済み(A 3 / B 11 / C 0、`docs/phase4-evaluation.md`)。残りは、エミュレータでの通し確認(未実施)。UI は、ダーク・ギャラリーへの刷新を並行して進行中(`docs/superpowers/specs/2026-10-18-dark-visual-redesign-design.md`、手順 1・2 完了、手順 3 作業中)。

(旧)着手前に必要だったこと:

1. SerpApi・楽天市場 API の公式ドキュメント・料金・利用規約の調査と、ユーザーへの報告
2. SerpApi の API キーの取得(ユーザー)
3. 楽天のアプリ登録とアフィリエイト設定(ユーザー)

要件は `docs/product-identification-requirements.md`。

## (旧)Phase 3 の着手前に決めること(設計で解決済み)

1. `apps/api` の構成(Fastify、zod、環境変数の読み込み、レート制限の入口)
2. `Detector` / `Embedder` / `CatalogProvider` / `Reranker` のインターフェース(`packages/shared` に型を追加)
3. 写真品質評価をクライアント側かサーバー側のどちらで行うか
4. Anthropic モデルの選定(コスト・精度の比較。実測してから決める)
