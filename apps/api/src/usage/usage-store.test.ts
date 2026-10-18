import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  describe('SerpApi の直近 1 時間の呼び出し', () => {
    const base = d('2026-10-18T03:00:00Z').getTime();
    const t = (min: number) => new Date(base + min * 60_000);

    it('addSerpapi は月間と直近 1 時間の両方に加算し、1 時間より古いものは数えない', () => {
      const s = new FileUsageStore(null);
      s.addSerpapi(t(0), 2);
      s.addSerpapi(t(30), 1);
      expect(s.serpapiLastHour(t(30))).toBe(3);
      expect(s.monthly(t(30)).serpapi).toBe(3);
      expect(s.serpapiLastHour(t(59))).toBe(3);
      expect(s.serpapiLastHour(t(61))).toBe(1);
      expect(s.serpapiLastHour(t(91))).toBe(0);
      expect(s.monthly(t(91)).serpapi).toBe(3);
    });

    it('addMonthly は 1 時間の集計に含めない(月間だけ)', () => {
      const s = new FileUsageStore(null);
      s.addMonthly(t(0), { serpapi: 5 });
      expect(s.serpapiLastHour(t(0))).toBe(0);
    });

    it('refundSerpapi は月間と直近 1 時間の両方から戻す(0 未満にはしない)', () => {
      const s = new FileUsageStore(null);
      s.addSerpapi(t(0), 2);
      s.refundSerpapi(t(1), 1);
      expect(s.serpapiLastHour(t(1))).toBe(1);
      expect(s.monthly(t(1)).serpapi).toBe(1);
      s.refundSerpapi(t(1), 5);
      expect(s.serpapiLastHour(t(1))).toBe(0);
      expect(s.monthly(t(1)).serpapi).toBe(0);
    });

    it('ファイルには時刻の数値だけを保存し、再読み込みしても残る。古いものは保存時に捨てる', () => {
      const dir = mkdtempSync(join(tmpdir(), 'usage-'));
      const file = join(dir, 'u.json');
      try {
        const s = new FileUsageStore(file);
        s.addSerpapi(t(0), 1);
        s.addSerpapi(t(90), 1);
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        expect(raw.serpapiCalls).toEqual([t(90).getTime()]);
        expect(new FileUsageStore(file).serpapiLastHour(t(91))).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('古い形式のファイル(serpapiCalls なし)や壊れた値も読める', () => {
      const dir = mkdtempSync(join(tmpdir(), 'usage-'));
      const file = join(dir, 'u.json');
      try {
        writeFileSync(file, JSON.stringify({ months: { '2026-10': { serpapi: 3 } }, days: {} }));
        const s = new FileUsageStore(file);
        expect(s.serpapiLastHour(t(0))).toBe(0);
        expect(s.monthly(t(0)).serpapi).toBe(3);
        writeFileSync(file, JSON.stringify({ months: {}, days: {}, serpapiCalls: [base, 'x', null, -1] }));
        expect(new FileUsageStore(file).serpapiLastHour(t(1))).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('429 の冷却は 5 分間だけ続く', () => {
      const s = new FileUsageStore(null);
      expect(s.serpapiCoolingDown(t(0))).toBe(false);
      s.markSerpapiRateLimited(t(0));
      expect(s.serpapiCoolingDown(t(4))).toBe(true);
      expect(s.serpapiCoolingDown(t(5))).toBe(false);
    });
  });
});
