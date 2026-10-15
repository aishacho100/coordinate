import { z } from 'zod';

/** 編集データ。写真本体とは分離し、JSONとして保存できる。座標は正規化(0〜1)。 */
export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

export const LabelStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number().positive(),
  textColor: z.string(),
  backgroundColor: z.string(),
  opacity: z.number().min(0).max(1),
  lineColor: z.string(),
  lineWidth: z.number().nonnegative(),
  arrow: z.enum(['none', 'simple', 'curved', 'dot']),
});
export type LabelStyle = z.infer<typeof LabelStyleSchema>;

export const LabelSchema = z.object({
  id: z.string().min(1),
  /** DetectedItem.id との対応。手動ラベルは null。 */
  itemId: z.string().nullable(),
  /** 線の起点(アイテム側)。 */
  anchor: PointSchema,
  /** ラベルの位置。 */
  position: PointSchema,
  brand: z.string(),
  name: z.string(),
  price: z.string(),
  show: z.object({ brand: z.boolean(), name: z.boolean(), price: z.boolean() }),
  visible: z.boolean(),
  style: LabelStyleSchema.partial(),
});
export type Label = z.infer<typeof LabelSchema>;

export const EditDocumentSchema = z.object({
  version: z.literal(1),
  templateId: z.string().min(1),
  aspect: z.enum(['original', '1:1', '4:5', '9:16']),
  crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  showPrices: z.boolean(),
  labels: z.array(LabelSchema),
});
export type EditDocument = z.infer<typeof EditDocumentSchema>;
