type Mod = typeof import('@/lib/image-search-consent');

const mockStore = new Map<string, string>();
let mockFailRead = false;
let mockFailWrite = false;
let mockFailDelete = false;

jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///doc/' },
  File: class MockFile {
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}${name}`;
    }
    get exists() {
      return mockStore.has(this.uri);
    }
    async text() {
      if (mockFailRead) throw new Error('read');
      return mockStore.get(this.uri) ?? '';
    }
    create() {
      if (mockFailWrite) throw new Error('create');
    }
    write(v: string) {
      if (mockFailWrite) throw new Error('write');
      mockStore.set(this.uri, v);
    }
    delete() {
      if (mockFailDelete) throw new Error('delete');
      mockStore.delete(this.uri);
    }
  },
}));

// モジュール内のメモリ上の値を毎回捨てるため、テストごとに読み込み直す。
const load = (): Mod => {
  let mod!: Mod;
  jest.isolateModules(() => {
    mod = require('@/lib/image-search-consent');
  });
  return mod;
};

beforeEach(() => {
  mockStore.clear();
  mockFailRead = mockFailWrite = mockFailDelete = false;
});

describe('image-search-consent', () => {
  it('保存が無ければ unset', async () => {
    expect(await load().getImageSearchConsent()).toBe('unset');
  });

  it('granted / declined は保存され、読み込み直しても残る', async () => {
    await load().setImageSearchConsent('granted');
    expect(await load().getImageSearchConsent()).toBe('granted');
    await load().setImageSearchConsent('declined');
    expect(await load().getImageSearchConsent()).toBe('declined');
  });

  it('壊れた内容は unset として扱う', async () => {
    mockStore.set('file:///doc/image-search-consent.txt', 'maybe');
    expect(await load().getImageSearchConsent()).toBe('unset');
  });

  it('clear で unset に戻り、保存も消える', async () => {
    const m = load();
    await m.setImageSearchConsent('granted');
    await m.clearImageSearchConsent();
    expect(await m.getImageSearchConsent()).toBe('unset');
    expect(await load().getImageSearchConsent()).toBe('unset');
  });

  it('読み込みに失敗しても unset を返し、例外を投げない', async () => {
    mockStore.set('file:///doc/image-search-consent.txt', 'granted');
    mockFailRead = true;
    expect(await load().getImageSearchConsent()).toBe('unset');
  });

  it('保存に失敗しても、その起動中は選択を保持する', async () => {
    mockFailWrite = true;
    const m = load();
    await expect(m.setImageSearchConsent('granted')).resolves.toBeUndefined();
    expect(await m.getImageSearchConsent()).toBe('granted');
  });

  it('削除に失敗したら unset を書き込み、読み込み直しても granted に戻らない', async () => {
    const m = load();
    await m.setImageSearchConsent('granted');
    mockFailDelete = true;
    await expect(m.clearImageSearchConsent()).resolves.toBeUndefined();
    expect(await m.getImageSearchConsent()).toBe('unset');
    expect(await load().getImageSearchConsent()).toBe('unset');
  });

  it('削除も unset の書き込みも失敗したら例外を投げ、granted のままだと分かる', async () => {
    const m = load();
    await m.setImageSearchConsent('granted');
    mockFailDelete = true;
    mockFailWrite = true;
    await expect(m.clearImageSearchConsent()).rejects.toThrow();
    expect(await m.getImageSearchConsent()).toBe('granted');
  });
});
