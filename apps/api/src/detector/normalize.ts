import { BoxSchema, DEFAULT_CATEGORIES, type DetectedItem } from '@coordinate/shared';

import type { RawItem, RawOutput } from './schema';

const CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
const EPS = 1e-6;

const unit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

/** 比較用に正規化する。アポストロフィは除き、それ以外の記号・空白は単語の区切り(半角スペース 1 つ)にする。 */
function words(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * ブランドが、文章の中に「語として丸ごと」現れているかを判定する。
 * 文字の断片(THE → The North Face)や別の単語に埋もれた一致(ON → SEASON)は一致とみなさない。
 * 空白の有無の違い(NewBalance ↔ New Balance)は同じとみなす。
 */
export function containsWholeWords(brand: string, text: string): boolean {
  const b = words(brand);
  const bCompact = b.replace(/ /g, '');
  if (bCompact.length < 2) return false;
  const w = words(text);
  if (w === '') return false;
  return ` ${w} `.includes(` ${b} `) || w.replace(/ /g, '') === bCompact;
}

/** ブランドが、写真内の読み取り文字の中に語として丸ごと現れていれば、その文字を返す。 */
function findEvidence(brand: string, visibleText: string[]): string | null {
  for (const t of visibleText) {
    if (containsWholeWords(brand, t)) return t;
  }
  return null;
}

function toItem(r: RawItem, id: string, model: string): DetectedItem | null {
  if (!CATEGORY_IDS.has(r.category_id)) return null;
  if (!BoxSchema.safeParse(r.box).success) return null;
  if (r.box.x + r.box.w > 1 + EPS || r.box.y + r.box.h > 1 + EPS) return null;
  if (!unit(r.detection_confidence) || !unit(r.category_confidence)) return null;

  const brandText = r.brand?.trim() ?? '';
  // 信頼度が範囲外のブランドは採用しない(項目自体は残す)。
  const evidence = brandText && unit(r.brand_confidence) ? findEvidence(brandText, r.visible_text) : null;
  const brandScore = r.brand_confidence;
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
