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
  searches: { serpapi: 'ok', rakuten: 'ok' },
  comparison: 'done',
  queries: ['q'],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 1 },
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
    expect(screen.queryByText(/同じ商品とは確認できていません/)).toBeNull();
  });

  it('B: 「候補が見つかりました」と、同じ商品とは確認できていない旨を書く', () => {
    render(<ProductCandidates response={response()} />);
    expect(screen.getByText('候補が見つかりました')).toBeTruthy();
    expect(screen.getByText('似ている商品です。同じ商品とは確認できていません。')).toBeTruthy();
  });

  it('C: 「特定できませんでした」と書き、候補は出さない', () => {
    render(<ProductCandidates response={response({ verdict: 'unidentified', candidates: [] })} />);
    expect(screen.getByText('特定できませんでした')).toBeTruthy();
    expect(
      screen.getByText('写真から読み取れる手がかりが足りず、商品名やブランドは決められませんでした。'),
    ).toBeTruthy();
    expect(screen.queryByText(/で見る/)).toBeNull();
  });

  it('価格は「¥」形式で、種別と取得日が付く。価格が無い候補は「価格は取得できませんでした」', () => {
    const noPrice: IdentifyCandidate = { ...rakuten, product: { ...rakuten.product, productId: 'r2', price: undefined } };
    render(<ProductCandidates response={response({ candidates: [google, rakuten, noPrice] })} />);
    expect(screen.getByText('¥16,500')).toBeTruthy();
    expect(screen.getByText('Google ショッピングの表示価格 ・ 10月18日時点')).toBeTruthy();
    expect(screen.getByText('¥7,590')).toBeTruthy();
    expect(screen.getByText('楽天市場の販売価格 ・ 10月18日時点')).toBeTruthy();
    expect(screen.getByText('価格は取得できませんでした')).toBeTruthy();
    expect(screen.getByText('ABC-MART')).toBeTruthy();
  });

  it('確信度の数値は出さない', () => {
    render(<ProductCandidates response={response()} />);
    expect(screen.queryByText(/0\.62|62%|0\.5/)).toBeNull();
  });

  it('Google の商品ページは「Google ショッピングで見る(販売元: ○○)」、楽天は「楽天市場で見る」。押すと開く', () => {
    render(<ProductCandidates response={response()} />);
    const g = screen.getByRole('link', { name: 'Google ショッピングで見る(販売元: ABC-MART)' });
    fireEvent.press(g);
    expect(openURL).toHaveBeenCalledWith(google.product.pageUrl);
    fireEvent.press(screen.getByRole('link', { name: '楽天市場で見る' }));
    expect(openURL).toHaveBeenCalledWith(rakuten.product.pageUrl);
  });

  it('販売元が無ければ「(販売元: …)」を付けず、pageUrl が無ければリンクを出さない', () => {
    const bare: IdentifyCandidate = { ...google, product: { ...google.product, seller: undefined } };
    const noUrl: IdentifyCandidate = { ...rakuten, product: { ...rakuten.product, productId: 'r3', pageUrl: undefined } };
    render(<ProductCandidates response={response({ candidates: [bare, noUrl] })} />);
    expect(screen.getByRole('link', { name: 'Google ショッピングで見る' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '楽天市場で見る' })).toBeNull();
  });

  it('楽天の検索が ok のときだけクレジットを出し、押すと開く', () => {
    const { unmount } = render(<ProductCandidates response={response()} />);
    fireEvent.press(screen.getByRole('link', { name: 'Supported by Rakuten Developers' }));
    expect(openURL).toHaveBeenCalledWith('https://developers.rakuten.com');
    unmount();
    render(<ProductCandidates response={response({ searches: { serpapi: 'ok', rakuten: 'failed' } })} />);
    expect(screen.queryByText('Supported by Rakuten Developers')).toBeNull();
  });

  it('使えなかった検索は理由を一行で出す', () => {
    render(
      <ProductCandidates
        response={response({ searches: { serpapi: 'budget_exhausted', rakuten: 'not_configured' } })}
      />,
    );
    expect(
      screen.getByText('Google ショッピングの検索は今月の上限に達しました。楽天市場の検索は未設定です。'),
    ).toBeTruthy();
  });

  it('失敗した検索は「失敗しました」と出し、すべて ok なら何も出さない', () => {
    const { unmount } = render(
      <ProductCandidates response={response({ searches: { serpapi: 'failed', rakuten: 'ok' } })} />,
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
