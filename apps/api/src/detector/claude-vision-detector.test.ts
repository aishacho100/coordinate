import type Anthropic from '@anthropic-ai/sdk';

import { ClaudeVisionDetector, DetectionError } from './claude-vision-detector';

const image = { data: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mediaType: 'image/jpeg' as const };

const goodJson = {
  full_body: true,
  items: [
    {
      category_id: 'sneakers',
      box: { x: 0.4, y: 0.8, w: 0.2, h: 0.15 },
      colors: ['白'],
      visible_text: ['NIKE'],
      brand: 'NIKE',
      brand_confidence: 0.7,
      detection_confidence: 0.9,
      category_confidence: 0.9,
      notes: null,
    },
    {
      category_id: 'spaceship',
      box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      colors: [],
      visible_text: [],
      brand: null,
      brand_confidence: 0,
      detection_confidence: 0.9,
      category_confidence: 0.9,
      notes: null,
    },
  ],
};

function client(response: Partial<Anthropic.Message>) {
  const create = jest.fn().mockResolvedValue({
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1500, output_tokens: 420 },
    content: [{ type: 'text', text: JSON.stringify(goodJson) }],
    ...response,
  });
  return { create, api: { messages: { create } } };
}

describe('ClaudeVisionDetector', () => {
  it('検出結果を検証して返し、トークン数とモデル名を記録する', async () => {
    const c = client({});
    const r = await new ClaudeVisionDetector(c.api, 'claude-sonnet-5-5', 'medium').detect(image);
    expect(r.items).toHaveLength(1); // 不正なカテゴリは破棄
    expect(r.items[0]).toMatchObject({ categoryId: 'sneakers', level: 'medium' });
    expect(r.fullBody).toBe(true);
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.usage).toEqual({ inputTokens: 1500, outputTokens: 420 });
  });

  it('構造化出力・effort・画像を指定して呼び出す(tool_choice は強制しない)', async () => {
    const c = client({});
    await new ClaudeVisionDetector(c.api, 'claude-haiku-5-5', 'low').detect(image);
    const params = c.create.mock.calls[0]?.[0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.tool_choice).toBeUndefined();
    const content = params.messages[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
  });

  it('refusal は DetectionError(refusal)', async () => {
    const c = client({ stop_reason: 'refusal', content: [] });
    await expect(new ClaudeVisionDetector(c.api, 'm', 'medium').detect(image)).rejects.toMatchObject({
      code: 'refusal',
    });
  });

  it('max_tokens で打ち切られたら DetectionError(truncated)', async () => {
    const c = client({ stop_reason: 'max_tokens' });
    await expect(new ClaudeVisionDetector(c.api, 'm', 'medium').detect(image)).rejects.toMatchObject({
      code: 'truncated',
    });
  });

  it('JSON でない・スキーマに合わない出力は DetectionError(invalid_output)', async () => {
    for (const text of ['not json', JSON.stringify({ items: 'x' })]) {
      const c = client({ content: [{ type: 'text', text }] as Anthropic.Message['content'] });
      const p = new ClaudeVisionDetector(c.api, 'm', 'medium').detect(image);
      await expect(p).rejects.toBeInstanceOf(DetectionError);
      await expect(p).rejects.toMatchObject({ code: 'invalid_output' });
    }
  });

  it('SDK の例外はそのまま伝える', async () => {
    const create = jest.fn().mockRejectedValue(new Error('network'));
    const d = new ClaudeVisionDetector({ messages: { create } }, 'm', 'medium');
    await expect(d.detect(image)).rejects.toThrow('network');
  });
});
