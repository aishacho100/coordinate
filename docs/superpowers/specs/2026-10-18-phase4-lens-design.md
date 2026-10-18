# Phase 4 追加: Google Lens(画像検索)の導入 設計と実装手順

承認済み(2026-10-18)。前提: `docs/superpowers/specs/2026-10-18-phase4-identification-design.md`(基本設計)、`docs/phase4-lens-experiment.md`(実験結果)。実装済みの Phase 4(テキスト検索 + 照合 + 判定)に、画像検索を足す。

## 1. 目的と方針

テキスト検索では「似た商品」までしか見つからなかった(A が 0 件)。実験で、Lens は同じ商品(型番、正しいモデル)に近い結果を、販売店のページつきで返すと分かった。そこで、**Lens を最優先の候補の出どころにし、テキスト検索(Google Shopping + 楽天)は補助に回す。**判定のルール(verdict.ts の A・B・C)は変えない。

## 2. 流れ(1 アイテム)

1. サーバーが、切り抜きを Lens 用の JPEG(長辺 1024px、500KB 以下)に再エンコードする(新規 `prepareForLens`)。
2. 利用者が画像検索に同意している場合だけ、Lens を実行する(同意は 3 章)。
   a. `POST https://serpapi.com/image`(multipart: `image`、`api_key`)でアップロードし、`image_id` を得る(10 分で失効)。
   b. `GET https://serpapi.com/search.json?engine=google_lens&image_id=…&type=visual_matches&country=jp&hl=ja&api_key=…`。
   c. 結果の `visual_matches` を `Product` に整える(`source: 'google_lens'`、`productId` はリンク、`pageUrl` は https のみのリンク、`seller` は結果の `source`、価格は `price.extracted_value` があれば JPY で、種別は `market`。無ければ空)。
3. 並行して、Claude が検索語を作る(既存の QueryGenerator)。
4. Lens の候補(商品ページ付きで画像取得に成功したもの)が **3 件未満**のとき、またはLens が使えないとき(未同意・未設定・上限・失敗・結果なし)だけ、テキスト検索(既存の SerpApi Shopping + 楽天、検索語の順序・間隔・上限は既存どおり)を行う。
5. 照合に渡す候補は最大 12 件: Lens を最大 8 件、残りをテキスト検索(Google Shopping 最大 4、足りなければ楽天)で埋める。重複(同じ `source` と `productId`、または同じ `pageUrl`)は除く。
6. 照合(既存の Comparer)と判定(既存の `decideVerdict`)。

追加の考え方:
- Lens の結果は「商品のリスト」ではなく、ウェブ上の類似画像のページ(フリマの出品を含む)。**同一商品と判断できるのは、既存の A の条件を全部満たす場合だけ**(写真からブランドを読めている、候補名にブランド、画像の一致、名前や型番が特徴と合う、類似度 0.7 以上)。出品ページがあるだけでは A にしない。
- フリマ(メルカリ、ラクマなど)の価格は中古の出品価格。画面は、販売元の名前と価格の出典を必ず出す(既存どおり)。

## 3. 同意(プライバシー)

- Lens は、切り抜き画像を SerpApi と Google に渡す。サーバーは画像を保存しない(Phase 3 のまま)が、SerpApi のアップロード画像の保持期間は公開されていない。
- クライアントは、利用者が同意するまで画像検索を使わない。同意は端末に保存し、サーバーへのリクエストに `x-image-search-consent: 1` を付ける。**このヘッダーが無いリクエストでは、サーバーは Lens を実行しない**(`searches.lens = 'not_consented'`)。
- 同意の画面: 最初に「商品を探す」を押したとき、結果画面の中に説明のカードを出す。文面:「商品を探すため、切り抜いた画像を外部の画像検索(SerpApi・Google)に送ります。写真全体ではなく、アイテムの部分だけです。当社のサーバーには保存されません。」ボタンは「同意して探す」と「画像を送らずに探す」。後者はテキスト検索だけで探す(Lens なし)。選択は端末に保存し、設定画面からは変更できる(この Phase では、保存の削除だけでよい: 設定画面に「画像検索の同意を取り消す」を置く)。
- プライバシーポリシー(`C:\work\app\coordinate-site` の `privacy.html`)に、SerpApi と Google への画像送信、保持期間が公開されていないこと、楽天と Google Shopping へ検索語を送ることを追記する。

## 4. 費用と上限

- Lens の 1 検索は、SerpApi の 1 検索として数える(月間上限 `SERPAPI_MONTHLY_LIMIT` に含める)。アップロードが検索回数に数えられるかは公式に記載がない。実測(`/manage-api-key` の使用量、または検索履歴)で確認し、数えられる場合は 1 アイテムあたり 2 回として計上する。確認できるまでは、安全側(アップロードも 1 回と数える)で計上する。
- 1 アイテムの SerpApi 消費は、Lens 1 回(+アップロード 1 回)、補助のテキスト検索は Lens の結果が足りないときだけ 1〜2 回。
- 同じ画像の再検索は、画像のハッシュをキーに、メモリキャッシュ(既存と同じ TTL)から返す。
- `usage` に `lensSearches` を足す。
- Lens のタイムアウトは、アップロード 15 秒・検索 45 秒(実測で 15 秒では足りなかった)。環境変数 `LENS_UPLOAD_TIMEOUT_SECONDS` / `LENS_SEARCH_TIMEOUT_SECONDS` で変更でき、上限は 120 秒。

## 5. 応答とクライアントの変更

- `SearchStatusSchema` に `'not_consented'` を足す。`IdentifyResponse.searches` に `lens: SearchStatus` を足す。`usage` に `lensSearches` を足す。
- 候補のリンクの文言: `google_lens` → 「{販売元}で見る」(販売元が無ければ「商品ページを見る」)。`google_shopping` と `rakuten` は従来どおり。
- 使えなかった検索の理由に、Lens(「画像検索」)と「画像検索には同意が必要です」を足す。

## 6. 実装手順

各タスクはサブエージェントで、TDD、日本語コミット、末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。実 API を使うのは L2 の実応答確認(最大 2 検索)と L5 だけ。

- **L1 共有スキーマ**: 5 章のスキーマ変更。`config` に `lensEnabled`(`SERPAPI_API_KEY` があれば true)。モバイルが型エラーにならないよう、`ProductCandidates` の使えなかった検索の文言も合わせる(最小限)。
- **L2 LensSearcher と画像の準備**: `search/lens.ts`(`searchByImage(jpeg: Uint8Array)`)、`image/prepare-lens.ts`。**実装前に、実 API を 1〜2 回だけ呼んで、アップロードの応答の形と、`visual_matches` の実際のキー(特に画像のサムネイルのキーと URL のホスト、価格の形)を確認し、テストのフィクスチャに使う。**サムネイルが `encrypted-tbn*.gstatic.com` だけなら、サーバー側の取得(`fetchImage`)の許可ドメインに、このホストを**Lens のサムネイル用に**加える(サーバーが小さなサムネイルだけを取得する。`isAllowedImageUrl` の変更点は報告する)。SerpApi の画像プロキシのキーがあれば、そちらを使う。上限・キャッシュ・失敗理由(`detail`)は既存の SerpApiSearcher と同じ流儀。
- **L3 Identifier と route**: 2 章の流れ。route は `x-image-search-consent` を読み、Identifier に渡す。Lens が使えない場合のテキスト検索へのフォールバックと、ステータスの返し方をテストする(未同意、未設定、上限、失敗、結果なし)。
- **L4 モバイル**: 同意のカードと保存(`expo-file-system`)、ヘッダー送信、リンクの文言、使えなかった検索の文言、設定画面の「画像検索の同意を取り消す」。
- **L5 評価・文書・ポリシー**: `eval-identify.ts` に Lens を組み込み(同意あり)、SerpApi の1時間あたり50回の枠に収まるよう、実行は 30 回以内かつ前回から間を空ける。結果を `docs/phase4-evaluation.md` に記録。`docs/progress.md`・`docs/limitations.md` の更新。プライバシーポリシーの追記(`coordinate-site` のコミットと push は、内容を確認してから)。

## 7. 確認が残る点

- SerpApi の Image API の課金(検索回数に数えるか)と、アップロード画像の保持期間。
- Lens が結果を返さないアイテムの割合(実験では 6 件中 1 件)。
- フリマの出品を「商品」として見せる是非(販売元と価格の出典で区別する前提)。
