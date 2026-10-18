const MAX_LENGTH = 24;

/** 販促・性別・状態などの定型語。商品名の中身ではないので除く。 */
const NOISE = [
  /送料(?:無料|込み?)/g,
  /ポイント(?:UP|アップ|\d+倍)?/gi,
  /\d+倍/g,
  /\d+%\s*OFF/gi,
  /クーポン(?:配布中|利用可|あり)?/g,
  /公式(?:ストア|通販|ショップ)?/g,
  /国内正規品|正規品/g,
  /メンズ|レディース|ユニセックス|男女兼用/g,
  /新品|未使用/g,
  /即納|即日発送|あす楽|激安|セール|SALE/gi,
];

/** 英数字とハイフンの並びで、数字を含むものを型番とみなす(例 CJ4864-657)。 */
const MODEL_NUMBER = /(?<![A-Za-z0-9-])(?=[A-Z0-9-]*\d)[A-Z0-9]{2,}(?:-[A-Z0-9]+)+(?![A-Za-z0-9-])/;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tidy = (s: string) => s.replace(/[★☆♪※]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 商品候補の長い名前を、ラベルに載せる短い名前にする(端末内で決定的に行う)。
 * 販促の括弧・定型語・ブランド名の重複を除き、最初の意味のある区間を使い、型番があれば末尾に残す。24 文字まで。
 * 結果が空なら fallback を返す。
 */
export function shortProductName(name: string, brand: string, fallback = ''): string {
  let text = name.normalize('NFKC').replace(/　/g, ' ');
  // 【…】は位置を問わず販促・店名。先頭の [..] (..) も除く。
  text = text.replace(/【[^】]*】/g, ' ');
  for (;;) {
    const next = text.replace(/^\s*(?:\[[^\]]*\]|\([^)]*\)|「[^」]*」)/, '');
    if (next === text) break;
    text = next;
  }
  for (const re of NOISE) text = text.replace(re, ' ');

  const model = MODEL_NUMBER.exec(text)?.[0] ?? '';
  const b = brand.trim();
  const brandRe = b ? new RegExp(escapeRegExp(b), 'gi') : null;

  const segments = text
    .split(/\s*[|｜/／]\s*|\s+[-–—]\s+|\s*[–—]\s*/)
    .map((seg) => {
      let s = brandRe ? seg.replace(brandRe, ' ') : seg;
      if (model) s = s.replace(model, ' ');
      return tidy(s);
    });
  const base = segments.find((s) => s.replace(/[\s\p{P}\p{S}]/gu, '').length >= 2) ?? '';
  if (!base && !model) return fallback;

  if (!model) return clip(base, MAX_LENGTH);
  if (!base) return clip(model, MAX_LENGTH);
  const budget = MAX_LENGTH - model.length - 1;
  return budget >= 2 ? `${clip(base, budget)} ${model}` : clip(`${base} ${model}`, MAX_LENGTH);
}

function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}
