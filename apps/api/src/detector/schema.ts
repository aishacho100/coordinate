import { z } from 'zod';

import { DEFAULT_CATEGORIES } from '@coordinate/shared';

/** Claude の出力(snake_case)。構造化出力に渡す JSON Schema と、受け取った後の zod 検証を揃える。 */
export const RawItemSchema = z.object({
  category_id: z.string(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  colors: z.array(z.string()),
  visible_text: z.array(z.string()),
  brand: z.string().nullable(),
  brand_confidence: z.number(),
  detection_confidence: z.number(),
  category_confidence: z.number(),
  notes: z.string().nullable(),
});
export type RawItem = z.infer<typeof RawItemSchema>;

export const RawOutputSchema = z.object({
  full_body: z.boolean(),
  items: z.array(RawItemSchema),
});
export type RawOutput = z.infer<typeof RawOutputSchema>;

const num = { type: 'number' } as const;
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

/** 構造化出力用。数値の範囲などの制約は書かず、受信後に zod / normalize で検証する。 */
export const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['full_body', 'items'],
  properties: {
    full_body: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category_id',
          'box',
          'colors',
          'visible_text',
          'brand',
          'brand_confidence',
          'detection_confidence',
          'category_confidence',
          'notes',
        ],
        properties: {
          category_id: { type: 'string', enum: DEFAULT_CATEGORIES.map((c) => c.id) },
          box: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y', 'w', 'h'],
            properties: { x: num, y: num, w: num, h: num },
          },
          colors: { type: 'array', items: { type: 'string' } },
          visible_text: { type: 'array', items: { type: 'string' } },
          brand: nullableString,
          brand_confidence: num,
          detection_confidence: num,
          category_confidence: num,
          notes: nullableString,
        },
      },
    },
  },
} as const;
