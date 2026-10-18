import { fetchImage, type ImageFetchLike } from './fetch-image';

const URL_OK = 'https://serpapi.com/images/url/abc.webp';
const res = (body: Uint8Array, headers: Record<string, string> = { 'content-type': 'image/webp' }, ok = true) => ({
  ok,
  status: ok ? 200 : 404,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
});
const fake = (r: ReturnType<typeof res>): ImageFetchLike & { calls: any[] } => {
  const f = (async (url: string, init?: unknown) => {
    f.calls.push({ url, init });
    return r;
  }) as ImageFetchLike & { calls: any[] };
  f.calls = [];
  return f;
};

describe('fetchImage', () => {
  it('取得して data と mediaType を返し、redirect: error で呼ぶ', async () => {
    const f = fake(res(new Uint8Array([1, 2, 3])));
    const out = await fetchImage(URL_OK, { fetchImpl: f });
    expect(out).toEqual({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/webp' });
    expect(f.calls[0].init.redirect).toBe('error');
  });
  it('content-type のパラメータ・大文字は許容する', async () => {
    const out = await fetchImage(URL_OK, { fetchImpl: fake(res(new Uint8Array([1]), { 'content-type': 'Image/JPEG; charset=x' })) });
    expect(out?.mediaType).toBe('image/jpeg');
  });
  it('許可されない URL は取得しない', async () => {
    const f = fake(res(new Uint8Array([1])));
    expect(await fetchImage('https://encrypted-tbn0.gstatic.com/x', { fetchImpl: f })).toBeNull();
    expect(await fetchImage('http://serpapi.com/images/url/a', { fetchImpl: f })).toBeNull();
    expect(f.calls).toHaveLength(0);
  });
  it('画像以外の content-type・非 2xx は null', async () => {
    expect(await fetchImage(URL_OK, { fetchImpl: fake(res(new Uint8Array([1]), { 'content-type': 'text/html' })) })).toBeNull();
    expect(await fetchImage(URL_OK, { fetchImpl: fake(res(new Uint8Array([1]), { 'content-type': 'image/svg+xml' })) })).toBeNull();
    expect(await fetchImage(URL_OK, { fetchImpl: fake(res(new Uint8Array([1]), undefined, false)) })).toBeNull();
  });
  it('content-length が上限超なら読まない。実際の長さも検証する。空は null', async () => {
    let read = false;
    const big = res(new Uint8Array([1]), { 'content-type': 'image/png', 'content-length': '999999' });
    big.arrayBuffer = async () => {
      read = true;
      return new ArrayBuffer(1);
    };
    expect(await fetchImage(URL_OK, { fetchImpl: fake(big), maxBytes: 1000 })).toBeNull();
    expect(read).toBe(false);
    expect(await fetchImage(URL_OK, { fetchImpl: fake(res(new Uint8Array(2000), { 'content-type': 'image/png' })), maxBytes: 1000 })).toBeNull();
    expect(await fetchImage(URL_OK, { fetchImpl: fake(res(new Uint8Array(0))) })).toBeNull();
  });
  it('例外・タイムアウトは null', async () => {
    const boom: ImageFetchLike = async () => {
      throw new Error('x');
    };
    expect(await fetchImage(URL_OK, { fetchImpl: boom })).toBeNull();
    const hang: ImageFetchLike = (_u, init) =>
      new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))));
    expect(await fetchImage(URL_OK, { fetchImpl: hang, timeoutMs: 20 })).toBeNull();
  });
});
