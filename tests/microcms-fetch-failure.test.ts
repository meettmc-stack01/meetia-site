import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getResolvedPublishedArticles } from '../src/lib/microcms.ts';

const CONFIG = { serviceDomain: 'test-service', apiKey: 'test-api-key' };

test('microCMS API障害(fetchが例外を投げる)時、getResolvedPublishedArticlesは例外をそのまま伝播する(空配列やMarkdown版へ黙って切り替えない)', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => {
    throw new TypeError('network error');
  }) as typeof fetch;

  await assert.rejects(() => getResolvedPublishedArticles(CONFIG));
});

test('microCMS API障害(非OKレスポンス)時も、getResolvedPublishedArticlesは例外を投げる', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => new Response('error', { status: 500 })) as typeof fetch;

  await assert.rejects(() => getResolvedPublishedArticles(CONFIG));
});

test('取得成功時は記事一覧を返す(異常系ではなく正常系の確認)', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        contents: [{ id: 'abc', title: 'テスト記事', content: '<p>本文</p>', slug: 'test-article' }],
      }),
      { status: 200 },
    )) as typeof fetch;

  const articles = await getResolvedPublishedArticles(CONFIG);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].slug, 'test-article');
});
