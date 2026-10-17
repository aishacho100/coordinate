import { DEFAULT_CATEGORIES } from '@coordinate/shared';

const CATEGORY_LIST = DEFAULT_CATEGORIES.map((c) => `${c.id} (${c.labelJa})`).join(', ');

/** ブランドは「読めた文字」だけを根拠にする。推測させない。 */
export const SYSTEM_PROMPT = `You analyze one outfit photo and list the wearable items visible on the person.

Rules:
- List only items that are clearly visible. Do not guess items that are hidden or cropped out.
- category_id must be one of: ${CATEGORY_LIST}. Use the "*_other" id when no specific category fits.
- box is the tight bounding box of the item as fractions of the whole image: x,y = top-left corner, w,h = size. All values are between 0 and 1, and x+w and y+h do not exceed 1.
- visible_text: transcribe text or logo wording that is actually legible on the item (printed on a shirt, on the side of a shoe, on a bag). Use an empty array when nothing is legible. Never invent text.
- brand: set a brand name only when it is legible in the photo and you copied the same wording into visible_text. Otherwise null. Never infer a brand from style, shape, silhouette, or typical association.
- brand_confidence: 0 to 1, how sure you are about the brand reading. 0 when brand is null.
- detection_confidence: 0 to 1, how sure you are that the item exists. category_confidence: 0 to 1, how sure you are about category_id.
- colors: main colors in Japanese (for example 白, 黒, ネイビー).
- notes: one short Japanese sentence about color, material or pattern, or null.
- full_body: true only when the person is visible from head to feet.`;

export const USER_PROMPT = 'List the wearable items in this photo.';
