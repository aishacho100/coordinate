import { z } from 'zod';

/** 認識対象カテゴリ。データ駆動にして、将来の追加をコード変更なしで行えるようにする。 */
export const CategoryDefinitionSchema = z.object({
  id: z.string().min(1),
  group: z.enum(['clothing', 'shoes', 'bag', 'accessory', 'other']),
  labelJa: z.string().min(1),
});
export type CategoryDefinition = z.infer<typeof CategoryDefinitionSchema>;

export const DEFAULT_CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'tshirt', group: 'clothing', labelJa: 'Tシャツ' },
  { id: 'shirt', group: 'clothing', labelJa: 'シャツ' },
  { id: 'knit', group: 'clothing', labelJa: 'ニット' },
  { id: 'sweat', group: 'clothing', labelJa: 'スウェット' },
  { id: 'hoodie', group: 'clothing', labelJa: 'パーカー' },
  { id: 'jacket', group: 'clothing', labelJa: 'ジャケット' },
  { id: 'coat', group: 'clothing', labelJa: 'コート' },
  { id: 'pants', group: 'clothing', labelJa: 'パンツ' },
  { id: 'denim', group: 'clothing', labelJa: 'デニム' },
  { id: 'skirt', group: 'clothing', labelJa: 'スカート' },
  { id: 'onepiece', group: 'clothing', labelJa: 'ワンピース' },
  { id: 'clothing_other', group: 'clothing', labelJa: 'その他の衣類' },
  { id: 'sneakers', group: 'shoes', labelJa: 'スニーカー' },
  { id: 'leather_shoes', group: 'shoes', labelJa: '革靴' },
  { id: 'boots', group: 'shoes', labelJa: 'ブーツ' },
  { id: 'sandals', group: 'shoes', labelJa: 'サンダル' },
  { id: 'pumps', group: 'shoes', labelJa: 'パンプス' },
  { id: 'shoes_other', group: 'shoes', labelJa: 'その他の靴' },
  { id: 'shoulder_bag', group: 'bag', labelJa: 'ショルダーバッグ' },
  { id: 'handbag', group: 'bag', labelJa: 'ハンドバッグ' },
  { id: 'tote', group: 'bag', labelJa: 'トートバッグ' },
  { id: 'backpack', group: 'bag', labelJa: 'リュック' },
  { id: 'waist_bag', group: 'bag', labelJa: 'ウエストバッグ' },
  { id: 'bag_other', group: 'bag', labelJa: 'その他のバッグ' },
  { id: 'necklace', group: 'accessory', labelJa: 'ネックレス' },
  { id: 'ring', group: 'accessory', labelJa: '指輪' },
  { id: 'bracelet', group: 'accessory', labelJa: 'ブレスレット' },
  { id: 'pierce', group: 'accessory', labelJa: 'ピアス' },
  { id: 'earring', group: 'accessory', labelJa: 'イヤリング' },
  { id: 'watch', group: 'accessory', labelJa: '腕時計' },
  { id: 'sunglasses', group: 'accessory', labelJa: 'サングラス' },
  { id: 'hat', group: 'accessory', labelJa: '帽子' },
  { id: 'belt', group: 'accessory', labelJa: 'ベルト' },
  { id: 'muffler', group: 'accessory', labelJa: 'マフラー' },
  { id: 'stole', group: 'accessory', labelJa: 'ストール' },
  { id: 'accessory_other', group: 'accessory', labelJa: 'その他のアクセサリー' },
];

/** 正規化座標(0〜1)。画像解像度に依存しない。 */
export const BoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});
export type Box = z.infer<typeof BoxSchema>;

export const ConfidenceSchema = z.object({
  detection: z.number().min(0).max(1),
  category: z.number().min(0).max(1),
  brand: z.number().min(0).max(1).nullable(),
  model: z.number().min(0).max(1).nullable(),
  variant: z.number().min(0).max(1).nullable(),
  price: z.number().min(0).max(1).nullable(),
});
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** 表示方針。モデルのスコアをそのまま確率として見せず、段階で扱う。 */
export const IdentificationLevelSchema = z.enum(['high', 'medium', 'low', 'unidentified']);
export type IdentificationLevel = z.infer<typeof IdentificationLevelSchema>;

export const PriceKindSchema = z.enum(['list', 'sale', 'market', 'estimated', 'manual']);

export const ProductSchema = z.object({
  source: z.string().min(1),
  productId: z.string().min(1),
  brand: z.string(),
  name: z.string().min(1),
  modelNumber: z.string().optional(),
  color: z.string().optional(),
  imageUrl: z.string().url().optional(),
  pageUrl: z.string().url().optional(),
  /** 販売元(Google ショッピングの source など)。 */
  seller: z.string().optional(),
  price: z
    .object({
      amount: z.number().nonnegative(),
      currency: z.string().length(3),
      kind: PriceKindSchema,
      fetchedAt: z.string().datetime(),
    })
    .optional(),
  fetchedAt: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

export const ProductCandidateSchema = z.object({
  product: ProductSchema,
  matchScore: z.number().min(0).max(1),
  /** identical は商品として確認できた場合のみ。外観が似ているだけなら similar。 */
  matchType: z.enum(['identical', 'similar']),
});
export type ProductCandidate = z.infer<typeof ProductCandidateSchema>;

export const DetectedItemSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  box: BoxSchema,
  appearance: z.object({
    colors: z.array(z.string()),
    pattern: z.string().optional(),
    material: z.string().optional(),
    visibleText: z.array(z.string()),
    notes: z.string().optional(),
  }),
  brandCandidates: z.array(z.object({ name: z.string(), score: z.number().min(0).max(1) })),
  candidates: z.array(ProductCandidateSchema),
  confidence: ConfidenceSchema,
  level: IdentificationLevelSchema,
  reviewState: z.enum(['auto', 'confirmed', 'corrected', 'removed', 'manual']),
  rationale: z.string(),
  modelVersion: z.string(),
});
export type DetectedItem = z.infer<typeof DetectedItemSchema>;
