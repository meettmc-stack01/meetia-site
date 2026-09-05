import { renderPreview, type PreviewEnv } from './renderPreview.ts';
import { isArticlePublished } from '../src/lib/microcms.ts';

export interface Env extends PreviewEnv {
  ASSETS: Fetcher;
  MICROCMS_API_KEY?: string;
  MICROCMS_SERVICE_DOMAIN?: string;
  /** "true"の環境(preview)だけ/previewを有効化する。未設定・それ以外は常に404(安全側)。 */
  PREVIEW_ENABLED?: string;
}

/** /blog/{slug}/ 形式の記事詳細だけにマッチする。一覧(/blog/)やテーマ別一覧(/blog/theme/...)にはマッチしない。 */
const BLOG_DETAIL_PATTERN = /^\/blog\/([^/]+)\/?$/;

/** プレビュー外枠(preview-shell)は内部テンプレートであり、外部への直接公開は行わない。 */
function isPreviewShellPath(pathname: string): boolean {
  return pathname === '/preview-shell' || pathname === '/preview-shell/' || pathname.startsWith('/preview-shell/');
}

function isPreviewEnabled(env: Env): boolean {
  return env.PREVIEW_ENABLED === 'true';
}

export async function handleBlogDetail(request: Request, env: Env, slug: string): Promise<Response> {
  if (!env.MICROCMS_API_KEY || !env.MICROCMS_SERVICE_DOMAIN) {
    return new Response('Service Unavailable', { status: 503 });
  }

  let published: boolean;
  try {
    published = await isArticlePublished(
      { serviceDomain: env.MICROCMS_SERVICE_DOMAIN, apiKey: env.MICROCMS_API_KEY },
      slug,
    );
  } catch {
    // fail closed: microCMS API障害時は古い静的HTMLを返さず404にする。
    return new Response('Not Found', { status: 404 });
  }

  if (!published) {
    return new Response('Not Found', { status: 404 });
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 内部テンプレート(preview-shell)は外部から直接開かせない。
    // renderPreview内部のenv.ASSETS.fetch()はこの分岐を経由しないAssets bindingへの直接呼び出しのため影響しない。
    if (isPreviewShellPath(url.pathname)) {
      return new Response('Not Found', { status: 404 });
    }

    if (url.pathname === '/preview' || url.pathname === '/preview/') {
      if (!isPreviewEnabled(env)) {
        return new Response('Not Found', { status: 404 });
      }
      return renderPreview(request, env);
    }

    const match = BLOG_DETAIL_PATTERN.exec(url.pathname);
    if (match && match[1] !== 'theme') {
      const slug = decodeURIComponent(match[1]);
      return handleBlogDetail(request, env, slug);
    }

    return env.ASSETS.fetch(request);
  },
};
