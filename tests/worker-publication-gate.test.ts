import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleBlogDetail, type Env } from '../worker/index.ts';
import { resolveArticleTheme, resolveArticleSlug, resolveArticlePubDate } from '../src/lib/microcms.ts';

function makeAssetsFetcher(): { fetcher: Fetcher; calls: Request[] } {
  const calls: Request[] = [];
  const fetcher = {
    async fetch(request: Request) {
      calls.push(request);
      return new Response('static-html', { status: 200 });
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function makeEnv(assets: Fetcher, overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: assets,
    MICROCMS_API_KEY: 'test-api-key',
    MICROCMS_SERVICE_DOMAIN: 'test-service',
    ...overrides,
  };
}

/** slugフィルタ一覧(/blogs?filters=slug...)と単体GET(/blogs/{id})を区別して応答するmicroCMSモック。 */
function makeMicroCmsFetchMock(options: { slugMatch: boolean; idPublished: boolean }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('filters=slug')) {
      return new Response(
        JSON.stringify({ contents: options.slugMatch ? [{ id: 'abc' }] : [], totalCount: options.slugMatch ? 1 : 0 }),
        { status: 200 },
      );
    }
    // 単体GET(フォールバック): 公開中ならレコードを200で返し、非公開・不存在なら404。
    return options.idPublished
      ? new Response(JSON.stringify({ id: 'abc' }), { status: 200 })
      : new Response('Not Found', { status: 404 });
  }) as typeof fetch;
}

test('公開中記事はStatic Assetsへ通す(slugフィルタで一致)', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = makeMicroCmsFetchMock({ slugMatch: true, idPublished: true });

  const { fetcher, calls } = makeAssetsFetcher();
  const response = await handleBlogDetail(
    new Request('https://example.com/blog/published-slug/'),
    makeEnv(fetcher),
    'published-slug',
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'static-html');
  assert.equal(calls.length, 1);
});

test('slugフィールド未設定時はcontentIdとしての単体GETへフォールバックして公開判定する', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = makeMicroCmsFetchMock({ slugMatch: false, idPublished: true });

  const { fetcher, calls } = makeAssetsFetcher();
  const response = await handleBlogDetail(
    new Request('https://example.com/blog/abc/'),
    makeEnv(fetcher),
    'abc',
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test('公開終了・未存在記事は静的HTMLがあっても404', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = makeMicroCmsFetchMock({ slugMatch: false, idPublished: false });

  const { fetcher, calls } = makeAssetsFetcher();
  const response = await handleBlogDetail(
    new Request('https://example.com/blog/unpublished-slug/'),
    makeEnv(fetcher),
    'unpublished-slug',
  );

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0, 'Static Assetsは呼ばれない');
});

test('microCMS API障害時はfail closedで404(古い静的HTMLを返さない)', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => new Response('error', { status: 500 })) as typeof fetch;

  const { fetcher, calls } = makeAssetsFetcher();
  const response = await handleBlogDetail(
    new Request('https://example.com/blog/some-slug/'),
    makeEnv(fetcher),
    'some-slug',
  );

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});

test('Secretが未設定の場合は503(APIキーなしでStatic Assetsへ通さない)', async () => {
  const { fetcher, calls } = makeAssetsFetcher();
  const response = await handleBlogDetail(
    new Request('https://example.com/blog/some-slug/'),
    makeEnv(fetcher, { MICROCMS_API_KEY: undefined }),
    'some-slug',
  );

  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test('ブログ一覧・テーマ一覧はWorkerの公開判定を経由せずStatic Assetsへ直接通す', async () => {
  const { fetcher, calls } = makeAssetsFetcher();
  const env = makeEnv(fetcher);

  const listResponse = await worker.fetch(new Request('https://example.com/blog/'), env);
  const themeResponse = await worker.fetch(new Request('https://example.com/blog/theme/aroma/'), env);

  assert.equal(listResponse.status, 200);
  assert.equal(themeResponse.status, 200);
  assert.equal(calls.length, 2);
});

test('PREVIEW_ENABLEDがtrue以外(publication-test相当)では/previewは常に404で、下書き取得は一切行われない', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let microCmsCalls = 0;
  globalThis.fetch = (async () => {
    microCmsCalls++;
    throw new Error('microCMSへ到達してはならない');
  }) as typeof fetch;

  const { fetcher, calls } = makeAssetsFetcher();

  const undefinedEnvResponse = await worker.fetch(
    new Request('https://example.com/preview?contentId=abc&draftKey=key1'),
    makeEnv(fetcher),
  );
  const explicitFalseResponse = await worker.fetch(
    new Request('https://example.com/preview?contentId=abc&draftKey=key1'),
    makeEnv(fetcher, { PREVIEW_ENABLED: 'false' }),
  );
  const trailingSlashResponse = await worker.fetch(
    new Request('https://example.com/preview/?contentId=abc&draftKey=key1'),
    makeEnv(fetcher, { PREVIEW_ENABLED: 'false' }),
  );

  assert.equal(undefinedEnvResponse.status, 404);
  assert.equal(explicitFalseResponse.status, 404);
  assert.equal(trailingSlashResponse.status, 404);
  assert.equal(microCmsCalls, 0, 'microCMSの下書き取得(fetch)が呼ばれてはならない');
  assert.equal(calls.length, 0, 'Static Assetsも呼ばれない');
});

test('PREVIEW_ENABLED=trueの場合だけ/previewが有効化される(パラメータ欠如時は400)', async () => {
  const { fetcher } = makeAssetsFetcher();
  const response = await worker.fetch(
    new Request('https://example.com/preview'),
    makeEnv(fetcher, { PREVIEW_ENABLED: 'true' }),
  );
  // 400(パラメータ欠如)はrenderPreviewまで到達した証跡。404(環境無効)ではないことを確認する。
  assert.equal(response.status, 400);
});

test('/preview-shellへの直接アクセスはPREVIEW_ENABLEDの値によらず404(未置換テンプレートを見せない)', async () => {
  const { fetcher, calls } = makeAssetsFetcher();

  for (const path of ['/preview-shell', '/preview-shell/', '/preview-shell/index.html']) {
    for (const previewEnabled of ['true', 'false', undefined] as const) {
      const response = await worker.fetch(
        new Request(`https://example.com${path}`),
        makeEnv(fetcher, { PREVIEW_ENABLED: previewEnabled }),
      );
      assert.equal(response.status, 404, `${path} (PREVIEW_ENABLED=${previewEnabled})`);
    }
  }
  assert.equal(calls.length, 0, 'Static Assetsのpreview-shellが外部へそのまま返されてはならない');
});

test('CSS・画像などrun_worker_first対象外の経路はWorkerに到達しない想定のため、ここでは対象外', () => {
  // run_worker_firstの範囲(/preview, /blog/*)自体はwrangler.jsonc側の設定であり、
  // Workerコード側の単体テスト対象ではないため確認のみ記録する。
  assert.ok(true);
});

test('category.idがaroma/olfactory/dailyのいずれかなら対応するテーマを採用する', () => {
  assert.equal(resolveArticleTheme({ category: { id: 'aroma' } }), 'aroma');
  assert.equal(resolveArticleTheme({ category: { id: 'olfactory' } }), 'olfactory');
  assert.equal(resolveArticleTheme({ category: { id: 'daily' } }), 'daily');
});

test('未知のcategory.idは推測変換せずundefined(除外)にする', () => {
  assert.equal(resolveArticleTheme({ category: { id: 'fpdn603yw', name: '更新情報' } }), undefined);
  assert.equal(resolveArticleTheme({ category: undefined }), undefined);
  assert.equal(resolveArticleTheme({}), undefined);
});

test('slug未設定時はcontentIdへフォールバックする(microCMS側スキーマ未整備の暫定挙動)', () => {
  assert.equal(resolveArticleSlug({ id: 'abc123', title: 't', content: 'c' }), 'abc123');
  assert.equal(resolveArticleSlug({ id: 'abc123', title: 't', content: 'c', slug: 'my-slug' }), 'my-slug');
});

test('pubDate未設定時はpublishedAtへフォールバックする', () => {
  const date = resolveArticlePubDate({
    id: 'abc123',
    title: 't',
    content: 'c',
    publishedAt: '2026-09-05T00:00:00.000Z',
  });
  assert.equal(date.toISOString(), '2026-09-05T00:00:00.000Z');
});
