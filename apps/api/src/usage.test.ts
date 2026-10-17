import { estimateCostUsd } from './usage';

describe('estimateCostUsd', () => {
  it('単価が設定されていれば概算する', () => {
    const cost = estimateCostUsd(
      { inputTokens: 2_000_000, outputTokens: 500_000 },
      { inputPerMTok: 2, outputPerMTok: 10 },
    );
    expect(cost).toBeCloseTo(9);
  });

  it('単価が無ければ null', () => {
    expect(estimateCostUsd({ inputTokens: 1, outputTokens: 1 }, null)).toBeNull();
  });
});
