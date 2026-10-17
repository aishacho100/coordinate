import type { EditDocument, Label, LabelStyle, Point } from '@coordinate/shared';

import { DEFAULT_TEMPLATE_ID, getTemplate, type FontKey, type TemplateDefinition } from './templates';

export type ResolvedLabelStyle = Omit<LabelStyle, 'fontFamily'> & { fontFamily: FontKey };

export function createDocument(): EditDocument {
  return {
    version: 1,
    templateId: DEFAULT_TEMPLATE_ID,
    aspect: '4:5',
    crop: null,
    rotation: 0,
    showPrices: true,
    labels: [],
  };
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const clampPoint = (p: Point): Point => ({ x: clamp01(p.x), y: clamp01(p.y) });

/** 新規ラベルの初期位置。左右交互に、上から順に少しずつずらして配置する。 */
export function defaultSlot(index: number): { position: Point; anchor: Point } {
  const left = index % 2 === 0;
  const row = Math.floor(index / 2) % 5;
  const y = 0.1 + row * 0.16;
  return {
    position: { x: left ? 0.05 : 0.52, y },
    anchor: { x: left ? 0.42 : 0.58, y: y + 0.12 },
  };
}

export type NewLabelInput = {
  id: string;
  itemId?: string | null;
  brand?: string;
  name?: string;
  price?: string;
  /** 省略時は defaultSlot。指定時は 0〜1 に丸める。 */
  anchor?: Point;
  position?: Point;
};

export function addLabel(doc: EditDocument, input: NewLabelInput): EditDocument {
  if (doc.labels.some((l) => l.id === input.id)) throw new Error(`ラベルIDが重複しています: ${input.id}`);
  const slot = defaultSlot(doc.labels.length);
  const label: Label = {
    id: input.id,
    itemId: input.itemId ?? null,
    anchor: input.anchor ? clampPoint(input.anchor) : slot.anchor,
    position: input.position ? clampPoint(input.position) : slot.position,
    brand: input.brand ?? '',
    name: input.name ?? '',
    price: input.price ?? '',
    show: { brand: true, name: true, price: true },
    visible: true,
    style: {},
  };
  return { ...doc, labels: [...doc.labels, label] };
}

export function removeLabel(doc: EditDocument, id: string): EditDocument {
  if (!doc.labels.some((l) => l.id === id)) return doc;
  return { ...doc, labels: doc.labels.filter((l) => l.id !== id) };
}

export type LabelPatch = Partial<Omit<Label, 'id' | 'style' | 'show'>> & {
  style?: Partial<LabelStyle>;
  show?: Partial<Label['show']>;
};

export function updateLabel(doc: EditDocument, id: string, patch: LabelPatch): EditDocument {
  let changed = false;
  const labels = doc.labels.map((l) => {
    if (l.id !== id) return l;
    changed = true;
    return {
      ...l,
      ...patch,
      position: patch.position ? clampPoint(patch.position) : l.position,
      anchor: patch.anchor ? clampPoint(patch.anchor) : l.anchor,
      style: { ...l.style, ...patch.style },
      show: { ...l.show, ...patch.show },
    };
  });
  return changed ? { ...doc, labels } : doc;
}

export function setTemplate(doc: EditDocument, templateId: string): EditDocument {
  return { ...doc, templateId: getTemplate(templateId).id };
}

export function setAspect(doc: EditDocument, aspect: EditDocument['aspect']): EditDocument {
  return { ...doc, aspect };
}

export function setShowPrices(doc: EditDocument, showPrices: boolean): EditDocument {
  return { ...doc, showPrices };
}

/** 全ラベルの個別スタイル上書きを消し、テンプレート既定の見た目に戻す。位置は保持する。 */
export function resetLabelStyles(doc: EditDocument): EditDocument {
  return { ...doc, labels: doc.labels.map((l) => ({ ...l, style: {} })) };
}

/** 全ラベルの位置を既定配置に戻す。内容(ブランド名・商品名・価格)は保持する。 */
export function resetLayout(doc: EditDocument): EditDocument {
  return {
    ...doc,
    labels: doc.labels.map((l, i) => {
      const slot = defaultSlot(i);
      return { ...l, position: slot.position, anchor: slot.anchor };
    }),
  };
}

/** 写真を時計回りに90度回したとき、正規化座標のラベル位置も同じ向きに回す。 */
export function rotateLabels90(doc: EditDocument): EditDocument {
  const rot = (p: Point): Point => ({ x: 1 - p.y, y: p.x });
  return {
    ...doc,
    labels: doc.labels.map((l) => ({ ...l, position: clampPoint(rot(l.position)), anchor: clampPoint(rot(l.anchor)) })),
  };
}

/** テンプレート既定にラベル個別の上書きを重ねた、描画用のスタイル。 */
export function resolveLabelStyle(template: TemplateDefinition, label: Label): ResolvedLabelStyle {
  const { fontFamily, ...rest } = label.style;
  const font = fontFamily && isFontKey(fontFamily) ? fontFamily : template.style.fontFamily;
  return { ...template.style, ...rest, fontFamily: font };
}

function isFontKey(v: string): v is FontKey {
  return v === 'mincho' || v === 'gothic' || v === 'gothicBold' || v === 'latin' || v === 'hand';
}

export type LabelLines = { brand: string | null; name: string | null; price: string | null };

/** 表示対象の行。非表示設定・価格の全体オフ・空文字を反映する。表示すべき行が無ければ null。 */
export function visibleLines(label: Label, showPrices: boolean): LabelLines | null {
  if (!label.visible) return null;
  const brand = label.show.brand && label.brand.trim() ? label.brand.trim() : null;
  const name = label.show.name && label.name.trim() ? label.name.trim() : null;
  const price = showPrices && label.show.price && label.price.trim() ? label.price.trim() : null;
  if (!brand && !name && !price) return null;
  return { brand, name, price };
}

/** 金額の表示用文字列。 */
export function formatPrice(amount: number, currency = 'JPY'): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('金額が不正です');
  const symbol = currency === 'JPY' ? '¥' : `${currency} `;
  return `${symbol}${Math.round(amount).toLocaleString('en-US')}`;
}
