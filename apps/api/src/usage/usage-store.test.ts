import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileUsageStore, monthKey, dayKey } from './usage-store';

const d = (s: string) => new Date(s);

describe('UsageStore', () => {
  it('月ごとの検索回数とトークン数を積算する', () => {
    const s = new FileUsageStore(null);
    s.addMonthly(d('2026-10-18T00:00:00Z'), { serpapi: 2, rakuten: 1, claudeInput: 100, claudeOutput: 40 });
    s.addMonthly(d('2026-10-30T00:00:00Z'), { serpapi: 1 });
    expect(s.monthly(d('2026-10-31T00:00:00Z'))).toEqual({ serpapi: 3, rakuten: 1, claudeInput: 100, claudeOutput: 40 });
    expect(s.monthly(d('2026-11-01T00:00:00Z')).serpapi).toBe(0);
  });

  it('1 日あたりの回数を数え、上限を判定する(識別子はハッシュで保存)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-'));
    const file = join(dir, 'u.json');
    try {
      const s = new FileUsageStore(file);
      const now = d('2026-10-18T03:00:00Z');
      expect(s.tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(true);
      expect(s.tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(true);
      expect(s.tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(false);
      expect(s.tryConsumeDaily(now, 'install', 'other', 2)).toBe(true);
      const raw = readFileSync(file, 'utf8');
      expect(raw).not.toContain('abc-install-id');
      // 再読み込みしても残る
      expect(new FileUsageStore(file).tryConsumeDaily(now, 'install', 'abc-install-id', 2)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('前日より古い日次カウンタを捨てる', () => {
    const s = new FileUsageStore(null);
    s.tryConsumeDaily(d('2026-10-10T00:00:00Z'), 'ip', '1.2.3.4', 5);
    s.tryConsumeDaily(d('2026-10-18T00:00:00Z'), 'ip', '1.2.3.4', 5);
    expect(s.dailyKeyCount()).toBe(1);
  });

  it('月・日のキー', () => {
    expect(monthKey(d('2026-10-18T00:00:00Z'))).toBe('2026-10');
    expect(dayKey(d('2026-10-18T00:00:00Z'))).toBe('2026-10-18');
  });
});
