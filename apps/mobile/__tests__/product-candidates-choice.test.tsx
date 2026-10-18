import type { IdentifyCandidate, IdentifyResponse } from '@coordinate/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ProductCandidates } from '@/components/product-candidates';

const FETCHED = '2026-10-18T00:00:00.000Z';

const cand = (productId: string, name: string): IdentifyCandidate => ({
  product: {
    source: 'google_shopping',
    productId,
    brand: '',
    name,
    pageUrl: `https://example.com/${productId}`,
    price: { amount: 9900, currency: 'JPY', kind: 'market', fetchedAt: FETCHED },
    fetchedAt: FETCHED,
  },
  matchScore: 0.6,
  matchType: 'similar',
  matched: [],
  unconfirmed: [],
});

const response = (over: Partial<IdentifyResponse> = {}): IdentifyResponse => ({
  itemId: 'i',
  verdict: 'candidates',
  level: 'medium',
  rationale: '',
  candidates: [cand('p1', 'NIKE Air Force 1'), cand('p2', 'NIKE Dunk Low')],
  searches: { serpapi: 'ok', rakuten: 'ok', lens: 'ok' },
  comparison: 'done',
  queries: [],
  usage: { claude: { inputTokens: 1, outputTokens: 1 }, serpapiSearches: 1, rakutenCalls: 0, lensSearches: 0 },
  estimatedCostUsd: null,
  fetchedAt: FETCHED,
  timings: { total: 1 },
  ...over,
});

describe('ProductCandidates の候補の選択', () => {
  afterEach(() => jest.restoreAllMocks());

  it('カードは商品名で読み上げられ、選択中だけ selected になる', () => {
    render(<ProductCandidates response={response()} chosen={{ source: 'google_shopping', productId: 'p2' }} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'NIKE Air Force 1' }).props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByRole('button', { name: 'NIKE Dunk Low' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('カードを押すと onToggle にその候補が渡る', () => {
    const onToggle = jest.fn();
    render(<ProductCandidates response={response()} chosen={null} onToggle={onToggle} />);
    fireEvent.press(screen.getByRole('button', { name: 'NIKE Dunk Low' }));
    expect(onToggle).toHaveBeenCalledWith({ source: 'google_shopping', productId: 'p2' });
  });

  it('リンクを押してもカードの選択は変わらず、リンクが開く', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const onToggle = jest.fn();
    render(<ProductCandidates response={response({ candidates: [cand('p1', 'NIKE Air Force 1')] })} chosen={null} onToggle={onToggle} />);
    fireEvent.press(screen.getByRole('link', { name: 'Google ショッピングで見る' }));
    expect(openURL).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('A の自動選択では、ラベルに入れたことと値段が出品時点である旨を出す', () => {
    render(
      <ProductCandidates
        response={response({ verdict: 'identified', candidates: [cand('p1', 'NIKE Air Force 1')] })}
        chosen={{ source: 'google_shopping', productId: 'p1' }}
        autoApplied
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText('ラベルに入れました。値段は出品時点です')).toBeTruthy();
    expect(screen.getByText('10月18日時点')).toBeTruthy();
  });

  it('B で未選択のときは、選ぶとラベルに入る旨を短く出す。選んだら消える', () => {
    const { rerender } = render(<ProductCandidates response={response()} chosen={null} onToggle={() => {}} />);
    expect(screen.getByText('選ぶとラベルに入ります')).toBeTruthy();
    rerender(<ProductCandidates response={response()} chosen={{ source: 'google_shopping', productId: 'p1' }} onToggle={() => {}} />);
    expect(screen.queryByText('選ぶとラベルに入ります')).toBeNull();
    expect(screen.queryByText('ラベルに入れました。値段は出品時点です')).toBeNull();
  });
});
