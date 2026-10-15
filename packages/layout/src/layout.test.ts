import { EditDocumentSchema, LabelSchema, LabelStyleSchema } from '@coordinate/shared';

import {
  TEMPLATES,
  addLabel,
  aspectRatio,
  canRedo,
  canUndo,
  clampCrop,
  computeCrop,
  createDocument,
  createHistory,
  cropAspectRatio,
  defaultSlot,
  formatPrice,
  getTemplate,
  panCrop,
  pushHistory,
  redo,
  removeLabel,
  replacePresent,
  resetLayout,
  resetLabelStyles,
  resolveLabelStyle,
  rotateLabels90,
  computeConnector,
  nearestEdgePoint,
  setAspect,
  setShowPrices,
  setTemplate,
  undo,
  updateLabel,
  visibleLines,
  FONT_KEYS,
} from './index';

describe('history', () => {
  it('push → undo → redo が往復できる', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it('新しい操作でやり直し履歴を破棄する', () => {
    let h = pushHistory(pushHistory(createHistory(1), 2), 3);
    h = undo(h);
    h = pushHistory(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(9);
  });

  it('履歴が空のとき undo/redo は何もしない', () => {
    const h = createHistory('a');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    expect(canUndo(h)).toBe(false);
  });

  it('同一参照の push は履歴を増やさない', () => {
    const obj = { a: 1 };
    const h = createHistory(obj);
    expect(pushHistory(h, obj)).toBe(h);
  });

  it('ドラッグ中の置き換えは1回の undo で開始前に戻る', () => {
    let h = createHistory(0);
    h = pushHistory(h, 0.1); // 操作開始
    h = replacePresent(h, 0.2);
    h = replacePresent(h, 0.3);
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(0);
  });

  it('履歴の上限を超えたら古いものから捨てる', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = pushHistory(h, i);
    expect(h.past.length).toBe(100);
    expect(h.present).toBe(150);
  });
});

describe('crop', () => {
  it('比率を返す', () => {
    expect(aspectRatio('1:1', 100, 50)).toBe(1);
    expect(aspectRatio('4:5', 100, 50)).toBeCloseTo(0.8);
    expect(aspectRatio('original', 300, 200)).toBeCloseTo(1.5);
  });

  it('縦長写真(3000x4000)を 1:1 に切ると縦を詰める', () => {
    const r = computeCrop(3000, 4000, '1:1');
    expect(r.w).toBe(1);
    expect(r.h).toBeCloseTo(0.75);
    expect(cropAspectRatio(r, 3000, 4000)).toBeCloseTo(1);
  });

  it('横長写真(4000x3000)を 4:5 に切ると横を詰める', () => {
    const r = computeCrop(4000, 3000, '4:5');
    expect(r.h).toBe(1);
    expect(cropAspectRatio(r, 4000, 3000)).toBeCloseTo(0.8);
  });

  it('original は全体を返す', () => {
    expect(computeCrop(800, 600, 'original')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('矩形は画像外にはみ出さない', () => {
    const r = computeCrop(3000, 4000, '1:1', { cx: 0.5, cy: 0.99 });
    expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    const p = panCrop(computeCrop(3000, 4000, '1:1'), 0, -5);
    expect(p.y).toBe(0);
    expect(clampCrop({ x: -1, y: 2, w: 0.5, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('不正な画像サイズは例外', () => {
    expect(() => computeCrop(0, 100, '1:1')).toThrow();
  });
});

describe('templates', () => {
  it('6種類あり、IDが重複せず、要求された名称が揃っている', () => {
    expect(TEMPLATES).toHaveLength(6);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(6);
    expect(TEMPLATES.map((t) => t.nameJa)).toEqual(
      expect.arrayContaining(['ミニマル', '雑誌風', '手書き風', 'ラグジュアリー', 'ストリート']),
    );
  });

  it('スタイルはスキーマに適合し、フォントは既知のキーである', () => {
    for (const t of TEMPLATES) {
      expect(LabelStyleSchema.safeParse(t.style).success).toBe(true);
      expect(FONT_KEYS).toContain(t.style.fontFamily);
    }
  });

  it('未知のIDは先頭のテンプレートに退避する', () => {
    expect(getTemplate('nope').id).toBe(TEMPLATES[0]?.id);
  });
});

describe('document', () => {
  const base = createDocument();

  it('初期ドキュメントはスキーマに適合する', () => {
    expect(EditDocumentSchema.safeParse(base).success).toBe(true);
  });

  it('ラベル追加は元のドキュメントを変更しない(不変)', () => {
    const next = addLabel(base, { id: 'a', brand: 'BRAND', name: 'Name', price: '¥1,000' });
    expect(base.labels).toHaveLength(0);
    expect(next.labels).toHaveLength(1);
    expect(LabelSchema.safeParse(next.labels[0]).success).toBe(true);
    expect(EditDocumentSchema.safeParse(next).success).toBe(true);
  });

  it('ID重複は拒否する', () => {
    const d = addLabel(base, { id: 'a' });
    expect(() => addLabel(d, { id: 'a' })).toThrow();
  });

  it('ラベル更新: 位置は 0〜1 に丸め、スタイルは部分マージする', () => {
    let d = addLabel(base, { id: 'a' });
    d = updateLabel(d, 'a', { position: { x: 1.5, y: -2 }, style: { fontSize: 20 } });
    d = updateLabel(d, 'a', { style: { textColor: '#fff' } });
    expect(d.labels[0]?.position).toEqual({ x: 1, y: 0 });
    expect(d.labels[0]?.style).toEqual({ fontSize: 20, textColor: '#fff' });
  });

  it('存在しないIDの更新・削除は同一参照を返す', () => {
    const d = addLabel(base, { id: 'a' });
    expect(updateLabel(d, 'x', { brand: 'b' })).toBe(d);
    expect(removeLabel(d, 'x')).toBe(d);
  });

  it('削除できる', () => {
    const d = removeLabel(addLabel(base, { id: 'a' }), 'a');
    expect(d.labels).toHaveLength(0);
  });

  it('テンプレート・比率・価格表示の切り替え', () => {
    expect(setTemplate(base, 'luxury').templateId).toBe('luxury');
    expect(setTemplate(base, 'unknown').templateId).toBe(TEMPLATES[0]?.id);
    expect(setAspect(base, '9:16').aspect).toBe('9:16');
    expect(setShowPrices(base, false).showPrices).toBe(false);
  });

  it('既定スロットは画面内に収まり、左右交互になる', () => {
    for (let i = 0; i < 30; i++) {
      const s = defaultSlot(i);
      expect(s.position.x).toBeGreaterThanOrEqual(0);
      expect(s.position.x).toBeLessThanOrEqual(1);
      expect(s.position.y).toBeLessThan(1);
      expect(s.anchor.y).toBeLessThanOrEqual(1);
    }
    expect(defaultSlot(0).position.x).toBeLessThan(defaultSlot(1).position.x);
  });

  it('自動配置に戻す: 位置は戻り、内容は保持される', () => {
    let d = addLabel(base, { id: 'a', brand: 'B' });
    d = updateLabel(d, 'a', { position: { x: 0.9, y: 0.9 } });
    const r = resetLayout(d);
    expect(r.labels[0]?.position).toEqual(defaultSlot(0).position);
    expect(r.labels[0]?.brand).toBe('B');
  });

  it('スタイルのリセットで個別上書きが消える', () => {
    let d = addLabel(base, { id: 'a' });
    d = updateLabel(d, 'a', { style: { fontSize: 30 } });
    expect(resetLabelStyles(d).labels[0]?.style).toEqual({});
  });

  it('描画スタイルはテンプレート既定に個別上書きを重ねる', () => {
    let d = addLabel(base, { id: 'a' });
    d = updateLabel(d, 'a', { style: { fontSize: 30, fontFamily: 'hand' } });
    const s = resolveLabelStyle(getTemplate('minimal'), d.labels[0]!);
    expect(s.fontSize).toBe(30);
    expect(s.fontFamily).toBe('hand');
    expect(s.textColor).toBe(getTemplate('minimal').style.textColor);
  });

  it('未知のフォント指定はテンプレートのフォントに退避する', () => {
    let d = addLabel(base, { id: 'a' });
    d = updateLabel(d, 'a', { style: { fontFamily: 'Comic Sans' } });
    expect(resolveLabelStyle(getTemplate('street'), d.labels[0]!).fontFamily).toBe('gothicBold');
  });
});

describe('connector', () => {
  const rect = { x: 10, y: 10, w: 100, h: 40 };

  it('対象に最も近い辺の中点から線を引く', () => {
    expect(nearestEdgePoint(rect, { x: 300, y: 30 })).toEqual({ x: 110, y: 30 });
    expect(nearestEdgePoint(rect, { x: -50, y: 30 })).toEqual({ x: 10, y: 30 });
    expect(nearestEdgePoint(rect, { x: 60, y: 200 })).toEqual({ x: 60, y: 50 });
    expect(nearestEdgePoint(rect, { x: 60, y: -100 })).toEqual({ x: 60, y: 10 });
  });

  it('none: 直線のみ。矢じりも丸もない', () => {
    const c = computeConnector(rect, { x: 300, y: 30 }, 'none', 1);
    expect(c.head).toBeNull();
    expect(c.dot).toBe(false);
    expect(c.control).toBeNull();
    expect(c.path.startsWith('M 110.00 30.00 L 300.00 30.00')).toBe(true);
  });

  it('dot: 終点に丸', () => {
    expect(computeConnector(rect, { x: 300, y: 30 }, 'dot', 1).dot).toBe(true);
  });

  it('simple: 終点を頂点とする矢じり。右向きなら2点は終点より左', () => {
    const c = computeConnector(rect, { x: 300, y: 30 }, 'simple', 1);
    expect(c.head).not.toBeNull();
    const [a, tip, b] = c.head!;
    expect(tip).toEqual({ x: 300, y: 30 });
    expect(a.x).toBeLessThan(300);
    expect(b.x).toBeLessThan(300);
    expect(a.y).not.toBe(b.y);
  });

  it('curved: 制御点を持つ二次曲線', () => {
    const c = computeConnector(rect, { x: 300, y: 30 }, 'curved', 1);
    expect(c.control).not.toBeNull();
    expect(c.path).toContain('Q');
    expect(c.head).not.toBeNull();
  });

  it('始点と終点が同じ位置でも NaN を出さない', () => {
    const c = computeConnector(rect, { x: 110, y: 30 }, 'curved', 1);
    expect(c.path).not.toContain('NaN');
    expect(c.head).toBeNull();
  });
});

describe('rotateLabels90', () => {
  it('時計回りに回すと右上は右下へ、4回で元に戻る', () => {
    let d = addLabel(createDocument(), { id: 'a' });
    d = updateLabel(d, 'a', { position: { x: 1, y: 0 }, anchor: { x: 0.25, y: 0.5 } });
    const r = rotateLabels90(d);
    expect(r.labels[0]?.position).toEqual({ x: 1, y: 1 });
    let four = d;
    for (let i = 0; i < 4; i++) four = rotateLabels90(four);
    expect(four.labels[0]?.position.x).toBeCloseTo(1);
    expect(four.labels[0]?.position.y).toBeCloseTo(0);
    expect(four.labels[0]?.anchor.x).toBeCloseTo(0.25);
    expect(four.labels[0]?.anchor.y).toBeCloseTo(0.5);
  });
});

describe('visibleLines', () => {
  const make = () => addLabel(createDocument(), { id: 'a', brand: ' BRAND ', name: 'Name', price: '¥1,000' }).labels[0]!;

  it('全て表示', () => {
    expect(visibleLines(make(), true)).toEqual({ brand: 'BRAND', name: 'Name', price: '¥1,000' });
  });

  it('価格の全体オフで価格行が消える', () => {
    expect(visibleLines(make(), false)?.price).toBeNull();
  });

  it('個別の価格オフ・ブランドオフ・商品名オフ', () => {
    const l = { ...make(), show: { brand: false, name: false, price: true } };
    expect(visibleLines(l, true)).toEqual({ brand: null, name: null, price: '¥1,000' });
  });

  it('空文字の行は出さない。全部空/非表示なら null', () => {
    const empty = addLabel(createDocument(), { id: 'e' }).labels[0]!;
    expect(visibleLines(empty, true)).toBeNull();
    expect(visibleLines({ ...make(), visible: false }, true)).toBeNull();
    expect(visibleLines({ ...make(), show: { brand: false, name: false, price: false } }, true)).toBeNull();
  });
});

describe('formatPrice', () => {
  it('円は ¥ とカンマ区切り', () => {
    expect(formatPrice(12800)).toBe('¥12,800');
    expect(formatPrice(0)).toBe('¥0');
  });
  it('他通貨はコードを前置', () => {
    expect(formatPrice(99.4, 'USD')).toBe('USD 99');
  });
  it('不正な金額は例外', () => {
    expect(() => formatPrice(-1)).toThrow();
    expect(() => formatPrice(NaN)).toThrow();
  });
});
