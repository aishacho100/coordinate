import type { CropRect, NewLabelInput } from '@coordinate/layout';
import { DEFAULT_CATEGORIES } from '@coordinate/shared';

import { formatPrice } from '@/lib/format-price';

import { sameCandidate, type ResultItem } from './analysis-reducer';
import { shortProductName } from './short-product-name';

const LEFT_X = 0.05;
const RIGHT_X = 0.52;
const MIN_GAP = 0.1;
const MAX_Y = 0.88;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const categoryName = (id: string) => DEFAULT_CATEGORIES.find((c) => c.id === id)?.labelJa ?? '';

/** 選んだ候補からラベルの内容を作る。ブランドは item.brand を優先し、空のときだけ候補で補う。値段は JPY のときだけ。 */
function labelContent(it: ResultItem): { brand: string; name: string; price?: string } {
  const category = categoryName(it.categoryId);
  const brand = it.brand.trim();
  const response = it.identify.status === 'done' ? it.identify.response : null;
  const product = it.chosen ? response?.candidates.find((c) => sameCandidate(it.chosen, c.product))?.product : undefined;
  if (!product) return { brand, name: category };
  const finalBrand = brand || product.brand.trim();
  const price = product.price?.currency === 'JPY' ? formatPrice(product.price.amount, 'JPY') : undefined;
  return {
    brand: finalBrand,
    name: shortProductName(product.name, finalBrand, category),
    ...(price ? { price } : {}),
  };
}

/**
 * 認識結果をラベルの初期値に変換する。
 * アンカーはアイテム枠の中心(写真座標 → トリミング後のキャンバス座標)。
 * ラベルは中心が左半分なら左列、右半分なら右列に置き、同じ列で縦に近いものは MIN_GAP ずつずらす。
 * 返す順序は入力と同じ。
 */
export function itemsToLabelInputs(
  items: ResultItem[],
  crop: CropRect,
  newId: () => string,
): NewLabelInput[] {
  const anchors = items.map((it) => ({
    x: clamp01((it.box.x + it.box.w / 2 - crop.x) / crop.w),
    y: clamp01((it.box.y + it.box.h / 2 - crop.y) / crop.h),
  }));

  // 列ごとに、アンカーの y が小さい順に位置を決める。
  const positions = new Map<number, { x: number; y: number }>();
  for (const side of ['left', 'right'] as const) {
    const idx = anchors
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => (a.x < 0.5) === (side === 'left'))
      .sort((p, q) => p.a.y - q.a.y);
    let last = -Infinity;
    for (const { a, i } of idx) {
      const y = Math.min(Math.max(a.y - 0.04, last + MIN_GAP), MAX_Y);
      positions.set(i, { x: side === 'left' ? LEFT_X : RIGHT_X, y });
      last = y;
    }
  }

  return items.map((it, i) => ({
    id: newId(),
    itemId: it.id,
    ...labelContent(it),
    anchor: anchors[i],
    position: positions.get(i),
  }));
}
