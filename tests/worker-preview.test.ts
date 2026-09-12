import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPreview,
  buildPreviewReplacements,
  applyPreviewReplacements,
  type PreviewEnv,
} from '../worker/renderPreview.ts';

const SHELL_HTML = `<!doctype html><html><head><title>__PREVIEW_TITLE__ | MeetiA</title></head><body>
  <p class="post-date">__PREVIEW_DATE__</p>
  <span class="post-theme is-plain">__PREVIEW_THEME_LABEL__</span>
  __PREVIEW_EYECATCH_HTML__
  <div class="post-body">__PREVIEW_CONTENT_HTML__</div>
</body></html>`;

function makeAssetsFetcher(shellHtml: string): Fetcher {
  return {
    async fetch() {
      return new Response(shellHtml, { status: 200 });
    },
  } as unknown as Fetcher;
}

function makeEnv(overrides: Partial<PreviewEnv> = {}): PreviewEnv {
  return {
    ASSETS: makeAssetsFetcher(SHELL_HTML),
    MICROCMS_API_KEY: 'test-api-key',
    MICROCMS_SERVICE_DOMAIN: 'test-service',
    ...overrides,
  };
}

test('contentIdとdraftKeyの両方が無いと400', async () => {
  const request = new Request('https://example.com/preview');
  const response = await renderPreview(request, makeEnv());
  assert.equal(response.status, 400);
});

test('contentIdだけが無いと400', async () => {
  const request = new Request('https://example.com/preview?draftKey=abc');
  const response = await renderPreview(request, makeEnv());
  assert.equal(response.status, 400);
});

test('draftKeyだけが無いと400', async () => {
  const request = new Request('https://example.com/preview?contentId=abc');
  const response = await renderPreview(request, makeEnv());
  assert.equal(response.status, 400);
});

test('APIキーやdraftKeyが400応答の本文に含まれない', async () => {
  const request = new Request('https://example.com/preview');
  const response = await renderPreview(request, makeEnv({ MICROCMS_API_KEY: 'secret-key-value' }));
  const body = await response.text();
  assert.equal(body.includes('secret-key-value'), false);
});

test('microCMS取得失敗時、APIキーやdraftKeyがエラー応答へ含まれない', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () => new Response('internal detail with secret-key-value', { status: 500 })) as typeof fetch;

  const request = new Request('https://example.com/preview?contentId=abc&draftKey=my-draft-key-123');
  const response = await renderPreview(request, makeEnv());
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.equal(body.includes('secret-key-value'), false);
  assert.equal(body.includes('my-draft-key-123'), false);
});

test('プレビュー応答にno-store・noindex・Referrer-Policyが付く', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ id: 'abc', title: 'テスト記事', content: '<p>本文</p>' }),
      { status: 200 },
    )) as typeof fetch;

  const request = new Request('https://example.com/preview?contentId=abc&draftKey=key1');
  const response = await renderPreview(request, makeEnv());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
});

test('危険なHTML(script/onerror)がプレビュー本文から除去される', () => {
  const replacements = buildPreviewReplacements({
    id: 'abc',
    title: '<script>alert(1)</script>安全なタイトル',
    content: '<p>本文</p><script>alert(2)</script><img src="x" onerror="alert(3)">',
  });

  assert.equal(replacements.__PREVIEW_CONTENT_HTML__.includes('<script>'), false);
  assert.equal(replacements.__PREVIEW_CONTENT_HTML__.includes('onerror'), false);
  // タイトルはHTMLエスケープされ、タグとして解釈されない。
  assert.equal(replacements.__PREVIEW_TITLE__.includes('<script>'), false);
  assert.equal(replacements.__PREVIEW_TITLE__.includes('&lt;script&gt;'), true);
});

test('microCMSの日本時間の公開日を前日にずらさず表示する', () => {
  const replacements = buildPreviewReplacements({
    id: 'abc',
    title: 'テスト記事',
    content: '<p>本文</p>',
    pubDate: '2026-03-21T15:00:00.000Z',
  });

  assert.equal(replacements.__PREVIEW_DATE__, '2026年3月22日');
});

test('テンプレート適用後、記事中の偶然の一致でマーカーが二重置換されない', () => {
  const html = applyPreviewReplacements(SHELL_HTML, {
    __PREVIEW_TITLE__: 'タイトル',
    __PREVIEW_DESCRIPTION__: '',
    __PREVIEW_DATE__: '2026年9月5日',
    __PREVIEW_THEME_LABEL__: 'アロマテラピー',
    __PREVIEW_EYECATCH_HTML__: '',
    __PREVIEW_CONTENT_HTML__: '<p>本文中に __PREVIEW_DATE__ という文字列が偶然含まれる場合</p>',
  });

  // テンプレート側のマーカーは正しく置換される(1箇所のみ)。
  assert.match(html, /<p class="post-date">2026年9月5日<\/p>/);
  const dateOccurrences = html.split('2026年9月5日').length - 1;
  assert.equal(dateOccurrences, 1);
  // contentは最後に差し込まれるため、content内の偶然の同名文字列はそのまま残り、
  // テンプレート側の置換処理によって再走査・再置換されない(安全側の設計)。
  assert.match(html, /<div class="post-body"><p>本文中に __PREVIEW_DATE__ という文字列が偶然含まれる場合<\/p><\/div>/);
});
