import type { IdentifyCandidate, IdentifyResponse } from '@coordinate/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ProductCandidates } from '@/components/product-candidates';

const FETCHED = '2026-10-18T00:00:00.000Z';

const google: IdentifyCandidate = {
  product: {
    source: 'google_shopping',
    productId: 'g1',
    brand: '',
    name: 'NIKE Air Force 1 ホワイト',
    pageUrl: 'https://www.google.com/search?ibp=oshop&q=x',
    imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:a',
    seller: 'ABC-MART',
    price: { amount: 16500, currency: 'JPY', kind: 'market', fetchedAt: FETCHED },
    fetchedAt: FETCHED,
  },
  matchScore: 0.62,
  matchType: 'similar',
  matched: ['色', 'ロゴ'],
  unconfirmed: ['型番'],
};

const rakuten: IdentifyCandidate = {
  product: {
    source: 'rakuten',
    productId: 'r1',
    brand: '',
    name: '無地Tシャツ',
    pageUrl: 'https://item.rakuten.co.jp/shop/t1/',
    price: { amount: 7590, currency: 'JPY', kind: 'list', fetchedAt: FETCHED },
    fetchedAt: FETCHED,
  },
  matchScore: 0.5,
  matchType: 'similar',
  matched: [],
  unconfirmed: [],
};

const response = (over: Partial<IdentifyResponse> = {}): IdentifyResponse => ({
  itemId: 'item_1',
  verdict: 'candidates',
  level: 'low',
  rationale: '',
  candidates: [google, rakuten],
  searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
  comparison: 'done',
  queries: ['q'],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 1, lensSearches: 1 },
  estimatedCostUsd: 0.01,
  fetchedAt: FETCHED,
  timings: { total: 100 },
  ...over,
});

describe('ProductCandidates', () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it('A: 「特定できました」と、一致した点・確認できていない点を出す', () => {
    render(<ProductCandidates response={response({ verdict: 'identified', candidates: [google] })} />);
    expect(screen.getByText('特定できました')).toBeTruthy();
    expect(screen.getByText('一致した点: 色、ロゴ')).toBeTruthy();
    expect(screen.getByText('確認できていない点: 型番')).toBeTruthy();
    expect(screen.queryByText(/断定はできません/)).toBeNull();
  });

  it('B: 「候補が見つかりました」と、同じ商品とは断定できない旨を書く', () => {
    render(<ProductCandidates response={response()} />);
    expect(screen.getByText('候補が見つかりました')).toBeTruthy();
    expect(screen.getByText('似ている商品です。同じ商品と断定はできません。')).toBeTruthy();
  });

  it('C: 「特定できませんでした」と書き、候補は出さない', () => {
    render(<ProductCandidates response={response({ verdict: 'unidentified', candidates: [] })} />);
    expect(screen.getByText('特定できませんでした')).toBeTruthy();
    expect(
      screen.getByText('手がかりが足りず、商品名やブランドを決められませんでした。'),
    ).toBeTruthy();
    expect(screen.queryByText(/で見る/)).toBeNull();
  });

  it('価格は「¥」形式で、種別と取得日が付く。価格が無い候補は「価格は取得できませんでした」', () => {
    const noPrice: IdentifyCandidate = { ...rakuten, product: { ...rakuten.product, productId: 'r2', price: undefined } };
    render(<ProductCandidates response={response({ candidates: [google, rakuten, noPrice] })} />);
    expect(screen.getByText('¥16,500')).toBeTruthy();
    expect(screen.getByText('Google ショッピングの表示価格')).toBeTruthy();
    expect(screen.getByText('¥7,590')).toBeTruthy();
    expect(screen.getByText('楽天市場の販売価格')).toBeTruthy();
    expect(screen.getAllByText('10月18日時点')).toHaveLength(2);
    expect(screen.getByText('価格は取得できませんでした')).toBeTruthy();
    expect(screen.getByText('ABC-MART')).toBeTruthy();
  });

  it('一致の印は、写真と同じ(identical)と似ている(similar)で読み上げ名が分かれる', () => {
    const same: IdentifyCandidate = { ...google, matchType: 'identical' };
    render(<ProductCandidates response={response({ verdict: 'identified', candidates: [same, rakuten] })} />);
    expect(screen.getAllByLabelText('写真と同じ')).toHaveLength(1);
    expect(screen.getAllByLabelText('似ている')).toHaveLength(1);
  });

  it('確信度の数値は出さない', () => {
    render(<ProductCandidates response={response()} />);
    expect(screen.queryByText(/0\.62|62%|0\.5/)).toBeNull();
  });

  it('Google の商品ページは「Google ショッピングで見る」(販売元は別の行)、楽天は「楽天市場で見る」。押すと開く', () => {
    render(<ProductCandidates response={response()} />);
    const g = screen.getByRole('link', { name: 'Google ショッピングで見る' });
    fireEvent.press(g);
    expect(openURL).toHaveBeenCalledWith(google.product.pageUrl);
    fireEvent.press(screen.getByRole('link', { name: '楽天市場で見る' }));
    expect(openURL).toHaveBeenCalledWith(rakuten.product.pageUrl);
  });

  it('販売元が無ければ販売元の行を出さず、pageUrl が無ければリンクを出さない', () => {
    const bare: IdentifyCandidate = { ...google, product: { ...google.product, seller: undefined } };
    const noUrl: IdentifyCandidate = { ...rakuten, product: { ...rakuten.product, productId: 'r3', pageUrl: undefined } };
    render(<ProductCandidates response={response({ candidates: [bare, noUrl] })} />);
    expect(screen.getByRole('link', { name: 'Google ショッピングで見る' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '楽天市場で見る' })).toBeNull();
    expect(screen.queryByText('ABC-MART')).toBeNull();
  });

  it('長い販売元名でもリンクの文言は短いままで、販売元は別の行に 1 行で省略して出す', () => {
    const longSeller = '楽天市場 - ブランド古着の買取販売ベクトル スペシャルストア';
    const long: IdentifyCandidate = { ...google, product: { ...google.product, seller: longSeller } };
    render(<ProductCandidates response={response({ candidates: [long] })} />);
    expect(screen.getByRole('link', { name: 'Google ショッピングで見る' })).toBeTruthy();
    expect(screen.queryByText(/販売元:/)).toBeNull();
    const seller = screen.getByText(longSeller);
    expect(seller.props.numberOfLines).toBe(1);
    expect(seller.props.ellipsizeMode).toBe('tail');
  });

  it('Lens の販売元は長くてもリンク文言に使わず、別の行(1 行・省略)に出す', () => {
    const longSeller = 'あ'.repeat(21);
    const lens: IdentifyCandidate = {
      ...google,
      product: { ...google.product, source: 'google_lens', productId: 'l1', seller: longSeller, pageUrl: 'https://shop.example.com/p/1' },
    };
    render(<ProductCandidates response={response({ candidates: [lens] })} />);
    expect(screen.getByRole('link', { name: 'shop.example.comで見る' })).toBeTruthy();
    expect(screen.getByText(longSeller).props.numberOfLines).toBe(1);
  });

  it('商品名は 2 行までで省略する', () => {
    render(<ProductCandidates response={response({ candidates: [google] })} />);
    expect(screen.getByText('NIKE Air Force 1 ホワイト').props.numberOfLines).toBe(2);
  });

  it('「10月18日時点」は価格の種別とは別の行で、1 行にして途中で折り返さない', () => {
    render(<ProductCandidates response={response({ candidates: [google] })} />);
    const asOf = screen.getByText('10月18日時点');
    expect(asOf.props.numberOfLines).toBe(1);
    expect(screen.queryByText(/表示価格 ・/)).toBeNull();
  });

  it('Google Lens の候補は「{リンク先のホスト名}で見る」。販売元を名乗っても遷移先は偽れない', () => {
    const lens: IdentifyCandidate = {
      ...google,
      product: { ...google.product, source: 'google_lens', productId: 'l1', seller: 'ZOZOTOWN', pageUrl: 'https://www.evil.example/x?y=1' },
    };
    render(<ProductCandidates response={response({ candidates: [lens] })} />);
    expect(screen.queryByRole('link', { name: 'ZOZOTOWNで見る' })).toBeNull();
    fireEvent.press(screen.getByRole('link', { name: 'evil.exampleで見る' }));
    expect(openURL).toHaveBeenCalledWith(lens.product.pageUrl);
    expect(screen.getByText('ZOZOTOWN')).toBeTruthy();
  });

  it('Lens のリンク先が URL として読めないときは「商品ページを見る」', () => {
    const lens: IdentifyCandidate = {
      ...google,
      product: { ...google.product, source: 'google_lens', productId: 'l1', pageUrl: 'not a url' },
    };
    render(<ProductCandidates response={response({ candidates: [lens] })} />);
    expect(screen.getByRole('link', { name: '商品ページを見る' })).toBeTruthy();
  });

  it('楽天の候補を表示しているときだけクレジットを出し、押すと開く', () => {
    const { unmount } = render(<ProductCandidates response={response()} />);
    fireEvent.press(screen.getByRole('link', { name: 'Supported by Rakuten Developers' }));
    expect(openURL).toHaveBeenCalledWith('https://developers.rakuten.com');
    unmount();
    // 楽天の検索が ok でも、楽天の候補が無ければ出さない(Lens だけで足りた場合)。
    const lens: IdentifyCandidate = { ...google, product: { ...google.product, source: 'google_lens', productId: 'l1' } };
    render(<ProductCandidates response={response({ candidates: [lens, google] })} />);
    expect(screen.queryByText('Supported by Rakuten Developers')).toBeNull();
  });

  it('Lens だけで足りて呼び出し 0 回の検索(ok)は、何も出さない', () => {
    const lens: IdentifyCandidate = { ...google, product: { ...google.product, source: 'google_lens', productId: 'l1' } };
    render(
      <ProductCandidates
        response={response({
          candidates: [lens],
          searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
          usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 0, rakutenCalls: 0, lensSearches: 1 },
        })}
      />,
    );
    expect(screen.queryByText(/検索は/)).toBeNull();
    expect(screen.queryByText(/Rakuten/)).toBeNull();
  });

  it('使えなかった検索は理由を一行で出す', () => {
    render(
      <ProductCandidates
        response={response({ searches: { serpapi: 'budget_exhausted', rakuten: 'not_configured', lens: 'ok' } })}
      />,
    );
    expect(
      screen.getByText('Google ショッピングの検索は今月の上限に達しました。楽天市場の検索は未設定です。'),
    ).toBeTruthy();
  });

  it('画像検索が使えなかった理由(未同意・失敗)を出す', () => {
    const { unmount } = render(
      <ProductCandidates response={response({ searches: { serpapi: 'ok', rakuten: 'ok', lens: 'not_consented' } })} />,
    );
    expect(screen.getByText('画像検索は使っていません(同意が必要です)。')).toBeTruthy();
    unmount();
    render(<ProductCandidates response={response({ searches: { serpapi: 'ok', rakuten: 'ok', lens: 'failed' } })} />);
    expect(screen.getByText('画像検索は失敗しました。')).toBeTruthy();
  });

  it('失敗した検索は「失敗しました」と出し、すべて ok なら何も出さない', () => {
    const { unmount } = render(
      <ProductCandidates response={response({ searches: { serpapi: 'failed', rakuten: 'ok', lens: 'ok' } })} />,
    );
    expect(screen.getByText('Google ショッピングの検索は失敗しました。')).toBeTruthy();
    unmount();
    render(<ProductCandidates response={response()} />);
    expect(screen.queryByText(/検索は/)).toBeNull();
  });

  it('照合に失敗したときは、確定できない旨を出す', () => {
    render(<ProductCandidates response={response({ comparison: 'failed' })} />);
    expect(screen.getByText('画像との照合ができなかったため、確定できません')).toBeTruthy();
  });
});
