import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  hasConfirmFlag,
  assertStatusDraft,
  resolveCategoryIdMap,
  collectArticles,
  runMigration,
  CONFIRM_FLAG,
} from '../scripts/migrate-microcms-articles.mjs';

const BLOG_DIR = resolve(process.cwd(), 'src/content/blog');
const PUBLIC_DIR = resolve(process.cwd(), 'public');

const REQUIRED_CATEGORIES = [
  { id: 'cat-aroma', name: 'アロマテラピー' },
  { id: 'cat-olfactory', name: '嗅覚反応分析' },
  { id: 'cat-daily', name: '日々のこと' },
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** テスト用のfetchモック。URLとメソッドで分岐する。呼び出し履歴も記録する。 */
function makeFetchMock(handlers) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    for (const handler of handlers) {
      if (handler.match(url, method)) {
        return handler.respond(url, method, init);
      }
    }
    throw new Error(`未対応のfetch呼び出し: ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

function categoriesHandler(categories = REQUIRED_CATEGORIES) {
  return {
    match: (url) => url.includes('/api/v1/categories'),
    respond: () => jsonResponse({ contents: categories, totalCount: categories.length }),
  };
}

function slugCheckHandler(existingSlugs = new Set()) {
  return {
    // (2026-09-06訂正) slug重複確認はManagement APIではなく、下書き・公開の両方を含めた
    // 通常のContent API(?status=DRAFT,PUBLISH)を使う設計に変更した。Management APIの
    // 一覧応答にはslug等のカスタムフィールドが含まれず、実機確認で重複確認に使えないと判明したため。
    match: (url, method) =>
      url.includes('/api/v1/blogs') &&
      !url.includes('management') &&
      method === 'GET' &&
      url.includes('filters=slug'),
    respond: (url) => {
      const match = /filters=slug%5Bequals%5D([^&]+)/.exec(url) ?? /filters=slug\[equals\]([^&]+)/.exec(url);
      const slug = match ? decodeURIComponent(match[1]) : null;
      const hasDraftPublishStatus = url.includes('status=DRAFT%2CPUBLISH') || url.includes('status=DRAFT,PUBLISH');
      if (!hasDraftPublishStatus) {
        throw new Error('slug重複確認は下書きを含めるためstatus=DRAFT,PUBLISHを指定する必要があります');
      }
      const exists = slug && existingSlugs.has(slug);
      return jsonResponse({ contents: exists ? [{ id: `existing-${slug}` }] : [], totalCount: exists ? 1 : 0 });
    },
  };
}

function mediaUploadHandler(urlPrefix = 'https://images.microcms-assets.io') {
  let counter = 0;
  return {
    match: (url, method) => url.includes('microcms-management.io/api/v1/media') && method === 'POST',
    respond: () => {
      counter += 1;
      return jsonResponse({ url: `${urlPrefix}/mock-${counter}` });
    },
  };
}

function createArticleHandler({ shouldFail = () => false, createdPayloads = [] } = {}) {
  let counter = 0;
  return {
    match: (url, method) => url.includes('/api/v1/blogs') && !url.includes('management') && method === 'POST',
    respond: (url, method, init) => {
      assertStatusDraft(url);
      const payload = JSON.parse(init.body);
      createdPayloads.push(payload);
      counter += 1;
      if (shouldFail(url)) {
        return new Response('server error', { status: 500 });
      }
      return jsonResponse({ id: `created-${counter}` }, 201);
    },
  };
}

test('hasConfirmFlag: フラグの有無を正しく判定する', () => {
  assert.equal(hasConfirmFlag([]), false);
  assert.equal(hasConfirmFlag(['--other']), false);
  assert.equal(hasConfirmFlag([CONFIRM_FLAG]), true);
});

test('assertStatusDraft: status=draft以外(未指定・別の値)は例外を投げる', () => {
  assert.throws(() => assertStatusDraft('https://example.microcms.io/api/v1/blogs'));
  assert.throws(() => assertStatusDraft('https://example.microcms.io/api/v1/blogs?status=publish'));
  assert.doesNotThrow(() => assertStatusDraft('https://example.microcms.io/api/v1/blogs?status=draft'));
});

test('resolveCategoryIdMap: 3カテゴリが揃っていればID対応表を返す', () => {
  const map = resolveCategoryIdMap(REQUIRED_CATEGORIES);
  assert.equal(map.get('アロマテラピー'), 'cat-aroma');
  assert.equal(map.get('嗅覚反応分析'), 'cat-olfactory');
  assert.equal(map.get('日々のこと'), 'cat-daily');
});

test('resolveCategoryIdMap: カテゴリが不足していれば例外を投げる(書き込み前に停止するための検査)', () => {
  const incomplete = REQUIRED_CATEGORIES.filter((c) => c.name !== '嗅覚反応分析');
  assert.throws(() => resolveCategoryIdMap(incomplete), /嗅覚反応分析/);
});

test('resolveCategoryIdMap: カテゴリ名が重複していれば例外を投げる', () => {
  const duplicated = [...REQUIRED_CATEGORIES, { id: 'cat-aroma-2', name: 'アロマテラピー' }];
  assert.throws(() => resolveCategoryIdMap(duplicated), /重複/);
});

test('collectArticles: 実在する15記事を変換し、エラー0件・eyecatch対象11件になる', async () => {
  const { articles, errors } = await collectArticles({ blogDir: BLOG_DIR, publicDir: PUBLIC_DIR });

  assert.equal(errors.length, 0);
  assert.equal(articles.length, 15);

  const withEyecatch = articles.filter((a) => a.eyecatchAbsolutePath);
  assert.equal(withEyecatch.length, 11);

  const whatIsSmell = articles.find((a) => a.slug === 'what-is-smell');
  assert.equal(whatIsSmell.categoryName, '嗅覚反応分析');
  const mayFatigue = articles.find((a) => a.slug === 'may-fatigue-type-aroma');
  assert.equal(mayFatigue.categoryName, '嗅覚反応分析');

  const draftArticle = articles.find((a) => a.slug === 'may-herb-water-mist-care');
  assert.equal(draftArticle.sourceDraft, true);
});

test('collectArticles: im-check-chartの本文内画像はアップロード対象から除外される', async () => {
  const { articles } = await collectArticles({ blogDir: BLOG_DIR, publicDir: PUBLIC_DIR });
  const imCheckChart = articles.find((a) => a.slug === 'im-check-chart');

  assert.ok(imCheckChart, 'im-check-chart記事が見つかること');
  assert.equal(imCheckChart.eyecatchAbsolutePath, null, 'eyecatchは未設定のまま');
  assert.equal(
    imCheckChart.inlineImagesRequiringUpload.length,
    0,
    '/images/chart-clean.pngはアップロード対象一覧から除外される',
  );
  assert.ok(
    imCheckChart.contentHtml.includes('/images/chart-clean.png'),
    '本文HTML自体は変更されずそのまま保持される',
  );
});

test('runMigration: 資格情報未設定ならネットワーク通信を一切行わずプレビューのみ返す', async () => {
  const failingFetch = async () => {
    throw new Error('資格情報が無い場合、fetchは一切呼ばれてはならない');
  };
  const outcome = await runMigration({
    argv: [],
    env: {},
    fetchImpl: failingFetch,
    loadDotEnvLocal: false,
  });

  assert.equal(outcome.mode, 'offline_preview');
  assert.equal(outcome.execute, false);
  assert.equal(outcome.plan.length, 15);
  assert.ok(outcome.resultsPath.includes('.local-backups'));

  const savedResult = JSON.parse(await readFile(outcome.resultsPath, 'utf8'));
  assert.equal(JSON.stringify(savedResult).includes('MICROCMS_API_KEY'), false);
});

test('runMigration: --confirm-microcms-write指定時に資格情報が無いと即座に例外を投げる(ネットワーク到達なし)', async () => {
  const failingFetch = async () => {
    throw new Error('資格情報が無い場合、fetchは一切呼ばれてはならない');
  };
  await assert.rejects(
    () =>
      runMigration({
        argv: [CONFIRM_FLAG],
        env: {},
        fetchImpl: failingFetch,
        loadDotEnvLocal: false,
      }),
    /MICROCMS_SERVICE_DOMAIN\/MICROCMS_API_KEY/,
  );
});

test('runMigration: カテゴリ対応が取れない場合、slug確認・作成・アップロードのいずれも行わず停止する', async () => {
  const incompleteCategories = REQUIRED_CATEGORIES.filter((c) => c.name !== '日々のこと');
  const { fetchImpl, calls } = makeFetchMock([categoriesHandler(incompleteCategories)]);

  await assert.rejects(
    () =>
      runMigration({
        argv: [],
        env: { MICROCMS_SERVICE_DOMAIN: 'test-service', MICROCMS_API_KEY: 'test-key' },
        fetchImpl,
      }),
    /日々のこと/,
  );

  // カテゴリ取得(GET)以外の呼び出し(slug確認・作成・アップロード)が発生していないこと。
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('runMigration: 資格情報ありでも--confirm-microcms-writeが無ければ、作成・アップロードのPOSTは一切発生しない(network dry-run)', async () => {
  const { fetchImpl, calls } = makeFetchMock([categoriesHandler(), slugCheckHandler()]);

  const outcome = await runMigration({
    argv: [],
    env: { MICROCMS_SERVICE_DOMAIN: 'test-service', MICROCMS_API_KEY: 'test-key' },
    fetchImpl,
  });

  assert.equal(outcome.mode, 'network_dry_run');
  assert.equal(outcome.execute, false);
  assert.equal(outcome.results.length, 15);
  assert.ok(outcome.results.every((r) => r.status === 'planned_create'));

  const postCalls = calls.filter((c) => c.method === 'POST');
  assert.equal(postCalls.length, 0, 'dry-runではPOST(作成・アップロード)が一切発生しない');

  const savedResult = JSON.parse(await readFile(outcome.resultsPath, 'utf8'));
  assert.equal(JSON.stringify(savedResult).includes('test-key'), false, '結果ファイルにAPIキーが含まれない');
});

test('runMigration: 実行時(--confirm-microcms-write)、記事作成は必ずstatus=draftで送信される', async () => {
  const createdPayloads = [];
  const { fetchImpl, calls } = makeFetchMock([
    categoriesHandler(),
    slugCheckHandler(),
    mediaUploadHandler(),
    createArticleHandler({ createdPayloads }),
  ]);

  const outcome = await runMigration({
    argv: [CONFIRM_FLAG],
    env: { MICROCMS_SERVICE_DOMAIN: 'test-service', MICROCMS_API_KEY: 'test-key' },
    fetchImpl,
  });

  assert.equal(outcome.mode, 'execute');
  assert.equal(outcome.results.length, 15);
  assert.ok(outcome.results.every((r) => r.status === 'created'));

  const createCalls = calls.filter(
    (c) => c.method === 'POST' && c.url.includes('/api/v1/blogs') && !c.url.includes('management'),
  );
  assert.equal(createCalls.length, 15);
  for (const call of createCalls) {
    assert.ok(call.url.includes('status=draft'), `全ての記事作成呼び出しにstatus=draftが付くこと: ${call.url}`);
  }

  const uploadCalls = calls.filter((c) => c.url.includes('microcms-management.io/api/v1/media'));
  assert.equal(uploadCalls.length, 11, 'eyecatchアップロードは11件だけ発生する');

  // (2026-09-06追記) 実機確認により、eyecatchはオブジェクトではなくプレーンな文字列URLで
  // 送信する必要があると判明した不具合を再発させないための回帰テスト。
  const payloadsWithEyecatch = createdPayloads.filter((p) => 'eyecatch' in p);
  assert.equal(payloadsWithEyecatch.length, 11);
  for (const payload of payloadsWithEyecatch) {
    assert.equal(typeof payload.eyecatch, 'string', 'eyecatchはオブジェクトではなくプレーンな文字列URLで送信すること');
  }
});

test('runMigration: 既存slugはスキップされ、上書き(PATCH等)は発生しない', async () => {
  const { fetchImpl, calls } = makeFetchMock([
    categoriesHandler(),
    slugCheckHandler(new Set(['first-time'])),
    mediaUploadHandler(),
    createArticleHandler(),
  ]);

  const outcome = await runMigration({
    argv: [CONFIRM_FLAG],
    env: { MICROCMS_SERVICE_DOMAIN: 'test-service', MICROCMS_API_KEY: 'test-key' },
    fetchImpl,
  });

  const firstTimeResult = outcome.results.find((r) => r.slug === 'first-time');
  assert.equal(firstTimeResult.status, 'skipped_existing');
  assert.equal(firstTimeResult.microcmsId, 'existing-first-time');

  const patchCalls = calls.filter((c) => c.method === 'PATCH' || c.method === 'PUT');
  assert.equal(patchCalls.length, 0, '既存コンテンツへの上書き(PATCH/PUT)は一切発生しない');

  const createCallsForFirstTime = calls.filter(
    (c) => c.method === 'POST' && c.url.includes('/api/v1/blogs') && !c.url.includes('management'),
  );
  // 15記事中、first-timeだけスキップされるため作成は14件のみ。
  assert.equal(createCallsForFirstTime.length, 14);
});

test('runMigration: 途中で作成に失敗したら即座に停止し、それまでの結果だけを記録する(秘密情報は含まない)', async () => {
  const { articles } = await collectArticles({ blogDir: BLOG_DIR, publicDir: PUBLIC_DIR });
  const failingSlug = articles[2].slug; // 3件目で失敗させる

  let createCallCount = 0;
  const { fetchImpl, calls } = makeFetchMock([
    categoriesHandler(),
    slugCheckHandler(),
    mediaUploadHandler(),
    {
      match: (url, method) => url.includes('/api/v1/blogs') && !url.includes('management') && method === 'POST',
      respond: (url) => {
        assertStatusDraft(url);
        createCallCount += 1;
        if (createCallCount === 3) {
          return new Response('internal error detail with test-key', { status: 500 });
        }
        return jsonResponse({ id: `created-${createCallCount}` }, 201);
      },
    },
  ]);

  await assert.rejects(
    () =>
      runMigration({
        argv: [CONFIRM_FLAG],
        env: { MICROCMS_SERVICE_DOMAIN: 'test-service', MICROCMS_API_KEY: 'test-key' },
        fetchImpl,
      }),
    new RegExp(failingSlug),
  );

  // 4件目以降は一切呼ばれていないこと(停止していること)。
  const createCalls = calls.filter(
    (c) => c.method === 'POST' && c.url.includes('/api/v1/blogs') && !c.url.includes('management'),
  );
  assert.equal(createCalls.length, 3);
});

test('runMigration: 失敗応答の本文にAPIキーが含まれていても、結果ファイル・例外メッセージへ生のAPIキーを書き出さない', async () => {
  const apiKey = 'secret-api-key-value';
  const { fetchImpl } = makeFetchMock([
    categoriesHandler(),
    slugCheckHandler(),
    mediaUploadHandler(),
    {
      match: (url, method) => url.includes('/api/v1/blogs') && !url.includes('management') && method === 'POST',
      respond: () => new Response(`failure containing ${apiKey}`, { status: 500 }),
    },
  ]);

  let thrown;
  try {
    await runMigration({
      argv: [CONFIRM_FLAG],
      env: { MICROCMS_SERVICE_DOMAIN: 'test-service', MICROCMS_API_KEY: apiKey },
      fetchImpl,
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, '失敗時は例外を投げること');
  assert.equal(thrown.message.includes(apiKey), false, '例外メッセージにAPIキーが含まれない');

  const match = /結果ファイル: (.+)$/.exec(thrown.message);
  assert.ok(match, '例外メッセージに結果ファイルパスが含まれること');
  const saved = await readFile(match[1], 'utf8');
  assert.equal(saved.includes(apiKey), false, '結果ファイルにAPIキーが含まれない(応答本文も保存しない)');
});
