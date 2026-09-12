import { isBlogTheme, type BlogTheme } from './blogThemes.ts';

export interface MicroCmsImage {
  url: string;
  height?: number;
  width?: number;
}

export interface MicroCmsCategory {
  id: string;
  name?: string;
}

export interface MicroCmsArticle {
  id: string;
  title: string;
  content: string;
  description?: string;
  pubDate?: string;
  publishedAt?: string;
  slug?: string;
  /** @deprecated microCMS側に同名フィールドは存在しない。categoryが正本。 */
  theme?: BlogTheme;
  category?: MicroCmsCategory;
  eyecatch?: MicroCmsImage;
}

export interface ResolvedArticle {
  id: string;
  title: string;
  description: string;
  pubDate: Date;
  slug: string;
  /** categoryの安定IDがaroma/olfactory/dailyのいずれとも一致しない場合はundefined(未知値として除外) */
  theme?: BlogTheme;
  categoryId?: string;
  content: string;
  eyecatch?: MicroCmsImage;
}

export interface MicroCmsServiceConfig {
  serviceDomain: string;
  apiKey: string;
}

interface DraftConfig extends MicroCmsServiceConfig {
  contentId: string;
  draftKey: string;
}

const BLOGS_ENDPOINT = 'blogs';

function buildServiceUrl(config: MicroCmsServiceConfig, path: string): URL {
  return new URL(`https://${config.serviceDomain}.microcms.io/api/v1/${path}`);
}

function authHeaders(apiKey: string): HeadersInit {
  return { 'X-MICROCMS-API-KEY': apiKey };
}

export async function getMicroCmsDraft(config: DraftConfig): Promise<MicroCmsArticle> {
  const url = buildServiceUrl(config, `${BLOGS_ENDPOINT}/${encodeURIComponent(config.contentId)}`);
  url.searchParams.set('draftKey', config.draftKey);

  const response = await fetch(url, { headers: authHeaders(config.apiKey) });

  if (!response.ok) {
    throw new Error(`microCMSの下書き取得に失敗しました (${response.status})`);
  }

  return response.json() as Promise<MicroCmsArticle>;
}

/** ビルド時: 公開中記事の一覧を取得する(通常GET。下書きは含まれない公式仕様)。 */
export async function getPublishedArticles(config: MicroCmsServiceConfig): Promise<MicroCmsArticle[]> {
  const url = buildServiceUrl(config, BLOGS_ENDPOINT);
  url.searchParams.set('limit', '100');

  const response = await fetch(url, { headers: authHeaders(config.apiKey) });

  if (!response.ok) {
    throw new Error(`microCMSの記事一覧取得に失敗しました (${response.status})`);
  }

  const data = (await response.json()) as { contents: MicroCmsArticle[] };
  return data.contents;
}

/**
 * リクエスト時: 指定slugの記事が公開中かどうかだけを確認する(通常GET、フィールドはidのみ)。
 * 公開終了・存在しない・API障害はすべてfalse相当として扱う呼び出し側でfail closedにする。
 */
async function isPublishedBySlugFilter(config: MicroCmsServiceConfig, slug: string): Promise<boolean> {
  const url = buildServiceUrl(config, BLOGS_ENDPOINT);
  url.searchParams.set('filters', `slug[equals]${slug}`);
  url.searchParams.set('limit', '1');
  url.searchParams.set('fields', 'id');

  const response = await fetch(url, { headers: authHeaders(config.apiKey) });

  if (!response.ok) {
    throw new Error(`microCMSの公開確認に失敗しました (${response.status})`);
  }

  const data = (await response.json()) as { contents: Array<{ id: string }> };
  return data.contents.length > 0;
}

/**
 * slugフィールド未設定時のフォールバック: 通常GETでcontentIdそのものとして公開状態を確認する。
 * resolveArticleSlug()のフォールバック(slug未設定時はid)とビルド時・リクエスト時で対称にするために必要。
 * 404は「未公開・存在しない」として扱い、それ以外の非OKはAPI障害として例外を投げる(fail closed)。
 */
async function isPublishedById(config: MicroCmsServiceConfig, contentId: string): Promise<boolean> {
  const url = buildServiceUrl(config, `${BLOGS_ENDPOINT}/${encodeURIComponent(contentId)}`);
  const response = await fetch(url, { headers: authHeaders(config.apiKey) });

  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`microCMSの公開確認に失敗しました (${response.status})`);
  }
  return true;
}

export async function isArticlePublished(config: MicroCmsServiceConfig, slugOrId: string): Promise<boolean> {
  if (await isPublishedBySlugFilter(config, slugOrId)) {
    return true;
  }
  return isPublishedById(config, slugOrId);
}

/** category.idがaroma/olfactory/dailyのいずれかと一致する場合だけテーマとして採用する。未知値は推測変換せずundefined。 */
export function resolveArticleTheme(article: Pick<MicroCmsArticle, 'category'>): BlogTheme | undefined {
  const categoryId = article.category?.id;
  if (categoryId && isBlogTheme(categoryId)) {
    return categoryId;
  }
  return undefined;
}

/** slugフィールド未設定時はcontentIdへ暫定フォールバックする(schema未整備時にビルドを止めないため)。 */
export function resolveArticleSlug(article: MicroCmsArticle): string {
  return article.slug && article.slug.length > 0 ? article.slug : article.id;
}

/** pubDateフィールド未設定時はpublishedAtへフォールバックする。 */
export function resolveArticlePubDate(article: MicroCmsArticle): Date {
  const raw = article.pubDate ?? article.publishedAt;
  return raw ? new Date(raw) : new Date(0);
}

export function resolveArticle(article: MicroCmsArticle): ResolvedArticle {
  return {
    id: article.id,
    title: article.title,
    description: article.description ?? '',
    pubDate: resolveArticlePubDate(article),
    slug: resolveArticleSlug(article),
    theme: resolveArticleTheme(article),
    categoryId: article.category?.id,
    content: article.content,
    eyecatch: article.eyecatch,
  };
}

/**
 * microCMSを完全な正本として使うモード(BLOG_SOURCE_PRIORITY=microcms)専用。
 * 取得に失敗した場合は例外をそのまま投げる(呼び出し側で握りつぶさない)。
 * これにより、API障害時に空配列やMarkdown版へフォールバックして古い内容を
 * 誤って表示するのではなく、ビルド自体を失敗させてCloudflare上の直前の
 * 正常なデプロイを維持できるようにする。
 */
export async function getResolvedPublishedArticles(config: MicroCmsServiceConfig): Promise<ResolvedArticle[]> {
  const articles = await getPublishedArticles(config);
  return articles.map(resolveArticle).sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());
}
