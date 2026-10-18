# Google Lens(画像検索)の実験結果

実施日: 2026-10-18。Phase 4 の評価で、テキスト検索(Google Shopping + 楽天)は「似た商品」までしか見つけられず、A(特定)が 0 件だったため、画像検索の効果を試した。

## 方法

- 評価用の写真(Unsplash の公開 URL)から、アイテム 6 個を選んだ。Unsplash の URL の切り抜き指定(`fit=crop&crop=focalpoint&fp-x&fp-y&fp-z`)で、アイテムの部分だけを公開 URL として渡した(自前のサーバーは使っていない)。
- SerpApi の `engine=google_lens`、`type=visual_matches`、`country=jp`、`hl=ja`。1 アイテム 1 検索、合計 6 検索。
- 上位 8 件の商品名を、切り抜きと目視で照合した。

## 結果

| アイテム | テキスト検索(従来) | Lens |
|---|---|---|
| NIKE のスニーカー(写真は Air Jordan 4 White Cement) | Air Jordan 1 が上位(モデル違い) | **Air Jordan 4 'White Cement' (FV5029-100)** が上位。Nike 公式、楽天、ZOZOTOWN、スニダンなど、同じ商品の販売ページが並んだ |
| NIKE の赤いパーカー | NIKE のパーカー(別物) | NIKE フレンチテリー スウッシュ プルオーバー(**型番 CJ4864-657**)など、近い商品が並んだ |
| adidas の迷彩ジャケット | 同じブランドの別の商品 | adidas の迷彩のアノラック/パーカーが並んだ(メルカリ、楽天など) |
| adidas のスニーカー(ミッドカット、キャメル) | Superstar など(形が違う) | adidas の BREAK START MID など、形が近いものが並んだ |
| ブランドが見えないスニーカー | - | 候補は出たが、同じ商品かは不明(ブランドを読めないため判断できない) |
| 手の込んだ小物など(1 件) | - | 「結果なし」(エラー、課金なし) |

- 価格(`price`)は、一部の結果にだけ付く(`￥2,900*` の形)。販売元は `source` に入る。
- Lens の結果の `link` は、販売店のページ(メルカリ、楽天市場、Nike 公式など)で、Google ショッピングの商品ページより購入先として直接的。

## 結論

写真そのもので探す Lens は、テキスト検索より**明らかに同じ商品に近い**。特に、ブランド文字が見えるアイテムで効果が大きい(型番や正しいモデルまで出る)。本実装する価値がある。

## SerpApi の Image API(画像のアップロード)

出典: https://serpapi.com/image-api

- `POST https://serpapi.com/image`(multipart、`image` と `api_key`)。形式は JPG/PNG/WebP、**最大 500KB**。
- 応答の `image_id` を `engine=google_lens` に渡せる。**`image_id` は 10 分で失効**する。
- 記載がない点: 課金(検索回数に数えるか)、画像ファイル自体の保持期間と削除方法、プライバシー上の注意。→ 本実装の前に SerpApi へ問い合わせるか、プライバシーポリシーに「外部の検索サービスに一時的に送る」と書く。

## 次の判断

- 本実装では、自前の公開サーバーは不要で、Image API の `image_id` を使える(切り抜きを 500KB 以下の JPEG にして送る)。
- ユーザーへの同意の表示と、プライバシーポリシーの更新が必要(画像が SerpApi と Google に渡る)。
