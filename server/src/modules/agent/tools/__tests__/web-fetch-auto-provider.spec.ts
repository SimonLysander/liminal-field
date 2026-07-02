import {
  AutoWebFetchProvider,
  DirectFetchProvider,
  FirecrawlWebFetchProvider,
  JinaReaderProvider,
  WebFetchError,
  createWebFetchProviderFromEnv,
  type WebFetchProvider,
  type WebFetchResponse,
} from '../web-fetch-provider';

function provider(
  name: string,
  impl: () => Promise<WebFetchResponse>,
): WebFetchProvider {
  return { name, fetch: jest.fn(impl) };
}

describe('AutoWebFetchProvider', () => {
  it('direct 成功时不调用 fallback', async () => {
    const direct = provider('direct', () =>
      Promise.resolve({
        url: 'https://a.dev',
        markdown: 'direct body',
        truncated: false,
        provider: 'direct',
      }),
    );
    const jina = provider('jina-reader', () =>
      Promise.reject(new Error('should not run')),
    );

    const got = await new AutoWebFetchProvider([direct, jina]).fetch(
      'https://a.dev',
      {},
    );

    expect(got.markdown).toBe('direct body');
    expect(got.provider).toBe('direct');
    expect(got.attempts).toEqual([
      expect.objectContaining({ provider: 'direct', status: 'ok' }),
    ]);
    expect(jina.fetch).not.toHaveBeenCalled();
  });

  it('direct 网络失败后调用 jina fallback', async () => {
    const direct = provider('direct', () =>
      Promise.reject(new WebFetchError('network', 'direct failed')),
    );
    const jina = provider('jina-reader', () =>
      Promise.resolve({
        url: 'https://a.dev',
        markdown: 'jina body',
        truncated: false,
        provider: 'jina-reader',
      }),
    );

    const got = await new AutoWebFetchProvider([direct, jina]).fetch(
      'https://a.dev',
      {},
    );

    expect(got.markdown).toBe('jina body');
    expect(got.provider).toBe('jina-reader');
    expect(got.attempts).toEqual([
      expect.objectContaining({
        provider: 'direct',
        status: 'error',
        kind: 'network',
      }),
      expect.objectContaining({ provider: 'jina-reader', status: 'ok' }),
    ]);
  });

  it('全部失败时抛出带 attempts 的 WebFetchError', async () => {
    const direct = provider('direct', () =>
      Promise.reject(new WebFetchError('network', 'direct failed')),
    );
    const jina = provider('jina-reader', () =>
      Promise.reject(new WebFetchError('timeout', 'jina timeout')),
    );

    await expect(
      new AutoWebFetchProvider([direct, jina]).fetch('https://a.dev', {}),
    ).rejects.toMatchObject({
      kind: 'timeout',
      attempts: [
        expect.objectContaining({ provider: 'direct', kind: 'network' }),
        expect.objectContaining({ provider: 'jina-reader', kind: 'timeout' }),
      ],
    });
  });
});

describe('createWebFetchProviderFromEnv', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('auto 配了 FIRECRAWL_API_KEY 时按 direct → firecrawl → jina 顺序', () => {
    process.env.WEB_FETCH_PROVIDER = 'auto';
    process.env.FIRECRAWL_API_KEY = 'fc-test';
    process.env.JINA_API_KEY = 'jina-test';

    const auto = createWebFetchProviderFromEnv();

    expect(auto).toBeInstanceOf(AutoWebFetchProvider);
    expect(
      (auto as unknown as { providers: WebFetchProvider[] }).providers,
    ).toEqual([
      expect.any(DirectFetchProvider),
      expect.any(FirecrawlWebFetchProvider),
      expect.any(JinaReaderProvider),
    ]);
  });

  it('auto 没配 FIRECRAWL_API_KEY 时仍使用 keyless firecrawl', () => {
    process.env.WEB_FETCH_PROVIDER = 'auto';
    delete process.env.FIRECRAWL_API_KEY;

    const auto = createWebFetchProviderFromEnv();

    expect(
      (auto as unknown as { providers: WebFetchProvider[] }).providers,
    ).toEqual([
      expect.any(DirectFetchProvider),
      expect.any(FirecrawlWebFetchProvider),
      expect.any(JinaReaderProvider),
    ]);
  });
});

describe('FirecrawlWebFetchProvider', () => {
  const OLD_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = OLD_FETCH;
    jest.restoreAllMocks();
  });

  it('调用 Firecrawl scrape API 并返回 markdown', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: '# Firecrawl body',
            metadata: { sourceURL: 'https://a.dev/final' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;

    const got = await new FirecrawlWebFetchProvider('fc-test').fetch(
      'https://a.dev',
      { maxLength: 1000 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.firecrawl.dev/v2/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer fc-test',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          url: 'https://a.dev',
          formats: ['markdown'],
          onlyMainContent: true,
          removeBase64Images: true,
          blockAds: true,
          timeout: 30000,
        }),
      }),
    );
    expect(got).toEqual({
      url: 'https://a.dev/final',
      markdown: '# Firecrawl body',
      truncated: false,
      provider: 'firecrawl',
    });
  });

  it('未配置 API key 时不发送 Authorization header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { markdown: 'keyless body' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;

    await new FirecrawlWebFetchProvider().fetch('https://a.dev', {});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('Firecrawl 限速时抛 rate_limited', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'too many' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      new FirecrawlWebFetchProvider('fc-test').fetch('https://a.dev', {}),
    ).rejects.toMatchObject({
      kind: 'rate_limited',
      message: expect.stringContaining('Firecrawl 限速'),
    });
  });
});
