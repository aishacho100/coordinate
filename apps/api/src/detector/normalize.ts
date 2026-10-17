import { BoxSchema, DEFAULT_CATEGORIES, type DetectedItem } from '@coordinate/shared';

import type { RawItem, RawOutput } from './schema';

const CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
const EPS = 1e-6;

const unit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s\-_.'’・]/g, '');
}

/** ブランドと一致する、写真内の読み取り文字を返す。1 文字だけの一致は根拠にしない。 */
function findEvidence(brand: string, visibleText: string[]): string | null {
  const b = norm(brand);
  if (b.length < 2) return null;
  for (const t of visibleText) {
    const n = norm(t);
    if (n.length < 2) continue;
    if (n.includes(b) || b.includes(n)) return t;
  }
  return null;
}

function toItem(r: RawItem, id: string, model: string): DetectedItem | null {
  if (!CATEGORY_IDS.has(r.category_id)) return null;
  if (!BoxSchema.safeParse(r.box).success) return null;
  if (r.box.x + r.box.w > 1 + EPS || r.box.y + r.box.h > 1 + EPS) return null;
  if (!unit(r.detection_confidence) || !unit(r.category_confidence)) return null;

  const brandText = r.brand?.trim() ?? '';
  const evidence = brandText ? findEvidence(brandText, r.visible_text) : null;
  const brandScore = unit(r.brand_confidence) ? r.brand_confidence : 0;
  const hasBrand = evidence !== null;

  return {
    id,
    categoryId: r.category_id,
    box: {
      x: r.box.x,
      y: r.box.y,
      w: Math.min(r.box.w, 1 - r.box.x),
      h: Math.min(r.box.h, 1 - r.box.y),
    },
    appearance: {
      colors: r.colors,
      visibleText: r.visible_text,
      ...(r.notes ? { notes: r.notes } : {}),
    },
    brandCandidates: hasBrand ? [{ name: brandText, score: brandScore }] : [],
    candidates: [],
    confidence: {
      detection: r.detection_confidence,
      category: r.category_confidence,
      brand: hasBrand ? brandScore : null,
      model: null,
      variant: null,
      price: null,
    },
    // 商品として確認できていないため high は使わない(Phase 4 で商品照合できた場合のみ)。
    level: hasBrand ? 'medium' : 'unidentified',
    reviewState: 'auto',
    rationale: hasBrand
      ? `写真内の文字「${evidence}」からブランド名を読み取りました`
      : 'ブランドを示す文字・ロゴが確認できませんでした',
    modelVersion: model,
  };
}

/** Claude の出力を検証し、不正な項目は破棄する。破棄した数は成功として数えない。 */
export function normalizeDetection(
  output: RawOutput,
  model: string,
): { items: DetectedItem[]; dropped: number } {
  const items: DetectedItem[] = [];
  let dropped = 0;
  for (const r of output.items) {
    const item = toItem(r, `item_${items.length + 1}`, model);
    if (item) items.push(item);
    else dropped += 1;
  }
  return { items, dropped };
}
