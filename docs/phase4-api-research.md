# Phase 4 API 調査(公式ドキュメントの確認結果)

調査日: 2026-10-18。出典は各公式ページ。確認できなかった点は「未確認」と明記する。

## SerpApi

出典: serpapi.com/pricing、/google-lens-api、/google-shopping-api、/legal

### 料金(公式の料金ページ)

| プラン | 月額 | 月間検索数 | 1 時間あたりの上限 |
|---|---|---|---|
| Free | $0 | 250 | 50 |
| Starter | $25 | 1,000 | 200 |
| Developer | $75 | 5,000 | 1,000 |
| Production | $150 | 15,000 | 3,000 |

- 成功した検索だけが数えられる。エラー・失敗は数えない。
- 同一のクエリとパラメータなら、1 時間以内のキャッシュ結果は無料で、検索数にも数えない。
- 超過料金の記載はない。検索数を使い切ったら、自動更新か手動更新で補充する。

### Google Lens(`engine=google_lens`)

- 画像は `url`(公開されている画像の URL)で渡す。別の方法として、Image API でアップロードして得た `image_id` を渡せる(アップロード API の詳細・課金は未確認)。
- `type` は `all` / `exact_matches` / `visual_matches`。`products` は、確認したページに記載がない。
- 結果は `visual_matches`(`title`、`link`、`source`、`thumbnail`、`image`)など。**確認したサンプルには `price` がない。**
- 日本向けの `country=jp`、`hl=ja` は形式上は指定できるが、日本での挙動は未確認。

### Google Shopping(`engine=google_shopping`)

- テキストで検索する。結果は `title`、`product_link`、`source`(販売元)、`price`、`extracted_price`、`thumbnail`。
- `gl=jp`、`hl=ja` が日本で使えるかは、公式の対応表で未確認。

### 規約

- 取得データの再利用・商用利用について、**明示的な許可も禁止も見当たらない**。商用で結果を表示・保存する前に、SerpApi へ問い合わせて文面で確認するのが安全。
- 検索データは SerpApi 側に 31 日間保持される。保存させない ZeroTrace は Enterprise 限定。画像を送るため、プライバシーポリシーへの記載が必要。

## 楽天ウェブサービス(楽天市場商品検索 API)

出典: webservice.rakuten.co.jp の documentation / guide / guide/rule / guide/credit

### 仕様

- 2026-07-01 版。エンドポイントは `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`。**旧エンドポイントは使えない可能性がある**(個人ブログの情報で、公式では未確認)。
- 認証は `applicationId` と `accessKey` の両方が必要。
- 検索は `keyword`、`genreId`、`itemCode`、`shopCode` のいずれか。**画像検索はない**(テキストだけ)。
- 取得できる項目: `itemName`、`itemPrice`、`itemCode`、`itemUrl`、`shopName`、`mediumImageUrls`(128×128、最大 3 枚)、`availability`、`reviewAverage` など。
- `affiliateId` を付けると、`itemUrl` と `affiliateUrl` がアフィリエイト URL になる。
- 制限: 具体的な数値の記載はない。超過時は HTTP 429。

### 登録

- 「New App」から登録。必須項目は、アプリ名、アプリ URL、アプリ種別、利用を許可する Web サイト、データ利用目的、想定 QPS。1 開発者あたり最大 5 アプリ。
- アフィリエイト ID は開発者ごとに 1 つ(楽天アフィリエイトの登録が別途必要)。

### 規約で注意する点

- **収益は楽天アフィリエイト経由に限る。** API を使って、それ以外の方法で収益を得ることは禁止(第 10 条)。楽天の商品について、他のアフィリエイトプログラムは許可なく使えない。
- **楽天のクレジット表示が必須。** 「Supported by Rakuten Developers」のテキスト、またはバナー(HTML スニペットは改変不可)。守らないと API が無効化されうる。
- 取得した情報を、不特定多数が共有できる形で保存するのは禁止。キャッシュ期間の定めはない。ユーザーに紐づく情報の保存は、楽天の許可が必要。
- 利用料金は、楽天が別途定めた場合のみ発生する。金額の記載はない。
- 競合サービスの禁止条項がある。「楽天以外も含めて商品を探す」アプリが該当しないかは、判断できないので楽天への確認が必要。

## 設計に影響する論点

1. **Lens に渡す画像の置き場所。** `url` は公開 URL が必要。Phase 3 の方針は「写真を保存しない」。選択肢: (a) 短時間だけ公開される一時 URL を自前のサーバーで発行して、使用後に削除する。(b) Image API でアップロードする(未確認)。(c) 画像検索を使わず、Claude が出した特徴語だけでテキスト検索する。(a)(b) は、画像が第三者に渡るため、プライバシーポリシーとユーザーへの説明が要る。
2. **価格の根拠。** Lens は価格を返さない。価格は Shopping と楽天から取り、出典と取得日時を付ける。
3. **ユーザーの許可なしに「確定」と表示しない。** 要件のとおり、商品ページ・型番・画像の一致がそろった場合だけ A 判定にする。

## ユーザーに用意してもらうもの

- SerpApi の API キー(Free プランで開始可能)。`apps/api/.env` にだけ置く。
- 楽天ウェブサービスのアプリ登録(`applicationId`、`accessKey`)と、楽天アフィリエイトの ID。
- 上記 1 の方針の決定。

## 未確認

- SerpApi の商用利用・保存の条件(問い合わせが必要)。
- Lens と Shopping が日本の商品でどれだけ当たるか(キー取得後に実測する)。
- 楽天の想定 QPS の上限、料金の発生条件。
