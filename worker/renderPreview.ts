import { getMicroCmsDraft, resolveArticleTheme, type MicroCmsArticle } from '../src/lib/microcms.ts';
import { sanitizeArticleHtml } from '../src/lib/sanitizeArticleHtml.ts';
import { themeLabel } from '../src/lib/blogThemes.ts';

export interface PreviewEnv {
  ASSETS: Fetcher;
  MICROCMS_API_KEY?: string;
  MICROCMS_SERVICE_DOMAIN?: string;
}

export const PREVIEW_SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

export function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function withSecurityHeaders(init: ResponseInit): ResponseInit {
  return {
    ...init,
    headers: {
      ...PREVIEW_SECURITY_HEADERS,
      ...(init.headers ?? {}),
    },
  };
}

/** microCMSの下書き記事をサニタイズ後にプレビュー外枠へ差し込むためのHTML置換マップを組み立てる。 */
export function buildPreviewReplacements(article: MicroCmsArticle): Record<string, string> {
  const theme = resolveArticleTheme(article);
  const themeLabelText = theme ? themeLabel(theme) : '';
  const pubDateSource = article.pubDate ?? article.publishedAt;
  const displayDate = pubDateSource
    ? new Date(pubDateSource).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Tokyo',
      })
    : '';
  const eyecatchHtml = article.eyecatch?.url
    ? `<figure class="post-hero-image"><img src="${escapeHtml(article.eyecatch.url)}" alt="" /></figure>`
    : '';

  return {
    __PREVIEW_TITLE__: escapeHtml(article.title ?? ''),
    __PREVIEW_DESCRIPTION__: escapeHtml(article.description ?? ''),
    __PREVIEW_DATE__: escapeHtml(displayDate),
    __PREVIEW_THEME_LABEL__: escapeHtml(themeLabelText),
    __PREVIEW_EYECATCH_HTML__: eyecatchHtml,
    __PREVIEW_CONTENT_HTML__: sanitizeArticleHtml(article.content ?? ''),
  };
}

/** テンプレート文字列へ置換マップを適用する。contentは最後に差し込み、他マーカーの再走査を避ける。 */
export function applyPreviewReplacements(shellHtml: string, replacements: Record<string, string>): string {
  let html = shellHtml;
  for (const marker of [
    '__PREVIEW_TITLE__',
    '__PREVIEW_DESCRIPTION__',
    '__PREVIEW_DATE__',
    '__PREVIEW_THEME_LABEL__',
    '__PREVIEW_EYECATCH_HTML__',
    '__PREVIEW_CONTENT_HTML__',
  ]) {
    html = html.split(marker).join(replacements[marker] ?? '');
  }
  return html;
}

export async function renderPreview(request: Request, env: PreviewEnv): Promise<Response> {
  const url = new URL(request.url);
  const contentId = url.searchParams.get('contentId');
  const draftKey = url.searchParams.get('draftKey');

  if (!contentId || !draftKey) {
    return new Response(
      'Bad Request: contentId and draftKey query parameters are required.',
      withSecurityHeaders({ status: 400 }),
    );
  }

  if (!env.MICROCMS_API_KEY || !env.MICROCMS_SERVICE_DOMAIN) {
    return new Response('Service Unavailable', withSecurityHeaders({ status: 503 }));
  }

  let article: MicroCmsArticle;
  try {
    article = await getMicroCmsDraft({
      serviceDomain: env.MICROCMS_SERVICE_DOMAIN,
      apiKey: env.MICROCMS_API_KEY,
      contentId,
      draftKey,
    });
  } catch {
    // microCMSからのエラー本文にAPIキーやdraftKeyが含まれないよう、固定メッセージのみ返す。
    return new Response('プレビュー記事を取得できませんでした。', withSecurityHeaders({ status: 502 }));
  }

  const shellResponse = await env.ASSETS.fetch(new URL('/preview-shell/', request.url));
  if (!shellResponse.ok) {
    return new Response('プレビュー外枠を取得できませんでした。', withSecurityHeaders({ status: 500 }));
  }
  const shellHtml = await shellResponse.text();
  const replacements = buildPreviewReplacements(article);
  const html = applyPreviewReplacements(shellHtml, replacements);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...PREVIEW_SECURITY_HEADERS,
    },
  });
}
