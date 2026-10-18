import type { Product } from '@coordinate/shared';

import { decideVerdict, type Judgement } from './verdict';

const product = (name: string, extra: Partial<Product> = {}): Product => ({
  source: 'rakuten',
  productId: name,
  brand: '',
  name,
  fetchedAt: '2026-10-18T00:00:00.000Z',
  ...extra,
});
const j = (over: Partial<Judgement> = {}): Judgement => ({
  index: 0,
  sameProduct: false,
  nameMatchesFeatures: false,
  similarity: 0,
  matched: [],
  unconfirmed: [],
  ...over,
});
const withImage = { imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' };
const allMatch = (over: Partial<Judgement> = {}) =>
  j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.9, ...over });

describe('decideVerdict', () => {
  const brandRead = 'Nike';
  const cands = [product('ナイキ エアフォース1 NIKE', withImage), product('adidas スーパースター', withImage)];

  it('A: 写真でブランドを読み取り、候補名に同じブランドがあり、画像も特徴も一致する', () => {
    const r = decideVerdict({
      brandRead,
      candidates: cands,
      judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.9, matched: ['ロゴ'] })],
    });
    expect(r.verdict).toBe('identified');
    expect(r.candidates[0]?.matchType).toBe('identical');
  });

  it('写真でブランドを読み取れていなければ A にしない(B に落とす)', () => {
    const r = decideVerdict({
      brandRead: null,
      candidates: cands,
      judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.95 })],
    });
    expect(r.verdict).toBe('candidates');
    expect(r.candidates[0]?.matchType).toBe('similar');
  });

  it('候補名に写真のブランドが無ければ A にしない', () => {
    const r = decideVerdict({
      brandRead,
      candidates: [product('無名ブランド スニーカー', withImage)],
      judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.95 })],
    });
    expect(r.verdict).toBe('candidates');
  });

  it('名前や特徴が合わない・画像が無い候補は A にしない', () => {
    const noImage = [product('ナイキ NIKE エアフォース1')];
    expect(
      decideVerdict({ brandRead, candidates: cands, judgements: [j({ sameProduct: true, nameMatchesFeatures: false, similarity: 0.9 })] }).verdict,
    ).toBe('candidates');
    expect(
      decideVerdict({ brandRead, candidates: noImage, judgements: [j({ sameProduct: true, nameMatchesFeatures: true, similarity: 0.9 })] }).verdict,
    ).toBe('candidates');
  });

  it('画像が同一商品と判断されていなければ A にしない', () => {
    const r = decideVerdict({
      brandRead,
      candidates: cands,
      judgements: [j({ sameProduct: false, nameMatchesFeatures: true, similarity: 0.9 })],
    });
    expect(r.verdict).toBe('candidates');
    expect(r.candidates[0]?.matchType).toBe('similar');
  });

  it('B: 似ている候補を類似度の高い順に最大 5 件。低い候補は含めない', () => {
    const many = Array.from({ length: 8 }, (_, i) => product(`p${i}`, withImage));
    const js = many.map((_, i) => j({ index: i, similarity: 0.15 + i / 10 }));
    const r = decideVerdict({ brandRead: null, candidates: many, judgements: js });
    expect(r.verdict).toBe('candidates');
    expect(r.candidates).toHaveLength(5);
    expect(r.candidates[0]?.matchScore).toBeGreaterThanOrEqual(r.candidates[4]!.matchScore);
    expect(r.candidates.every((c) => c.matchScore >= 0.25)).toBe(true);
  });

  it('B の足切りは 0.25: 0.25 は含め、0.24 は含めない', () => {
    const inc = decideVerdict({ brandRead: null, candidates: cands, judgements: [j({ similarity: 0.25 })] });
    expect(inc.verdict).toBe('candidates');
    const exc = decideVerdict({ brandRead: null, candidates: cands, judgements: [j({ similarity: 0.24 })] });
    expect(exc.verdict).toBe('unidentified');
  });

  it('C: 似ている候補が無い、または候補が無い', () => {
    expect(decideVerdict({ brandRead: null, candidates: [], judgements: [] }).verdict).toBe('unidentified');
    const r = decideVerdict({ brandRead: null, candidates: cands, judgements: [j({ similarity: 0.1 })] });
    expect(r.verdict).toBe('unidentified');
    expect(r.candidates).toEqual([]);
  });

  it('範囲外・重複の index は無視する', () => {
    const r = decideVerdict({
      brandRead: null,
      candidates: cands,
      judgements: [j({ index: 9, similarity: 0.9 }), j({ index: 0, similarity: 0.5 }), j({ index: 0, similarity: 0.99 })],
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.matchScore).toBe(0.5);
  });

  describe('境界: A にしてはいけないケース', () => {
    const ident = (br: string | null, name: string, over: Partial<Judgement> = {}, extra: Partial<Product> = withImage) =>
      decideVerdict({ brandRead: br, candidates: [product(name, extra)], judgements: [allMatch(over)] });

    it('読み取ったブランドが空文字・空白・1 文字なら A にしない', () => {
      for (const br of ['', '   ', 'N']) {
        const r = ident(br, 'ナイキ NIKE エアフォース1 N');
        expect(r.verdict).toBe('candidates');
        expect(r.candidates[0]?.matchType).toBe('similar');
      }
    });

    it('候補名にブランドの一部しか含まれなければ A にしない', () => {
      // ブランドの前半だけ(Nike → Nik)、語の途中への埋もれ(Nike → Nikelab)、
      // 短いブランドが別の単語に埋もれる(On → SEASON)。
      expect(ident('Nike', 'Nik スニーカー').verdict).toBe('candidates');
      expect(ident('Nike', 'Nikelab スニーカー').verdict).toBe('candidates');
      expect(ident('On', 'SEASON スニーカー').verdict).toBe('candidates');
      // 複数語ブランドの片方だけ
      expect(ident('The North Face', 'North スニーカー').verdict).toBe('candidates');
    });

    it('ブランドが product.brand にだけ書かれていても語として一致すれば A にできる', () => {
      const r = ident('Nike', 'エアフォース1', {}, { ...withImage, brand: 'NIKE' });
      expect(r.verdict).toBe('identified');
    });

    it('スペースの有無の違いは、名前全体がそのブランドだけのときに限り同じとみなす(保守的)', () => {
      expect(ident('NewBalance', 'New Balance').verdict).toBe('identified');
      // 型番などが続く場合は語の境界が崩れるため一致とみなさず、B に落ちる(A を出し過ぎない側に倒す)。
      expect(ident('NewBalance', 'New Balance 574').verdict).toBe('candidates');
    });

    it('similarity が NaN・Infinity・負なら A にしない。候補にも含めない', () => {
      for (const s of [NaN, Infinity, -Infinity, -1]) {
        const r = ident('Nike', 'NIKE エアフォース1', { similarity: s });
        expect(r.verdict).toBe('unidentified');
        expect(r.candidates).toEqual([]);
      }
    });

    it('similarity が低すぎる候補は、他の条件が揃っていても A にしない', () => {
      const r = ident('Nike', 'NIKE エアフォース1', { similarity: 0.2 });
      expect(r.verdict).toBe('unidentified');
    });

    it('A の類似度の下限は 0.7。0.69 は B、0.7 は A', () => {
      const low = ident('Nike', 'NIKE エアフォース1', { similarity: 0.69 });
      expect(low.verdict).toBe('candidates');
      expect(low.candidates[0]?.matchType).toBe('similar');
      expect(ident('Nike', 'NIKE エアフォース1', { similarity: 0.7 }).verdict).toBe('identified');
    });

    it('1 位が条件を満たさなくても、条件を満たす下位の候補があれば A はそれになる', () => {
      const r = decideVerdict({
        brandRead: 'Nike',
        candidates: [product('無名 スニーカー', withImage), product('NIKE エアフォース1', withImage)],
        judgements: [allMatch({ index: 0, similarity: 0.99 }), allMatch({ index: 1, similarity: 0.8 })],
      });
      expect(r.verdict).toBe('identified');
      expect(r.candidates[0]?.product.name).toBe('NIKE エアフォース1');
      expect(r.candidates[0]?.matchType).toBe('identical');
      expect(r.candidates[1]?.matchType).toBe('similar');
    });

    it('A のときも、候補は identical を 1 件だけ先頭に置き、最大 5 件に収める', () => {
      const many = Array.from({ length: 8 }, (_, i) => product(`NIKE p${i}`, withImage));
      const r = decideVerdict({
        brandRead: 'Nike',
        candidates: many,
        judgements: many.map((_, i) => allMatch({ index: i, similarity: 0.5 + i / 20 })),
      });
      expect(r.verdict).toBe('identified');
      expect(r.candidates).toHaveLength(5);
      expect(r.candidates.filter((c) => c.matchType === 'identical')).toHaveLength(1);
      expect(r.candidates[0]?.matchType).toBe('identical');
    });
  });
});
