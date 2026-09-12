// 既存Markdown15記事をmicroCMSへ移行する本番用スクリプト。
//
// 既定動作はdry-run(ネットワーク書き込み禁止)。実際にmicroCMSへ書き込むには、
// 明示的なCONFIRM_FLAG(--confirm-microcms-write)が必要。
//
// 安全設計の要点:
// - 記事作成は必ず `POST {endpoint}?status=draft` を使う。status=draft以外では絶対に送信しない(assertStatusDraftForCreate)。
// - 15記事すべて下書き作成のみ。公開(status=publish)への切替はこのスクリプトの範囲外。
// - eyecatchアップロード対象は、front matterにimageが設定された記事だけ(データ駆動。ハードコードしない)。
// - im-check-chartの本文内画像(/images/chart-clean.png)はアップロード・URL置換の対象にしない
//   (Worker側の既存Static Assetsで配信継続するため。本文HTMLはそのまま登録する)。
// - 登録前にslug重複を確認し、既存コンテンツは上書きしない(スキップして続行)。
// - カテゴリAPIを事前取得し、必要な3カテゴリ(アロマテラピー/嗅覚反応分析/日々のこと)のID対応が
//   取れない場合は、いかなる書き込みも行わずに停止する。
// - APIキー・draftKeyはログ・結果ファイルへ一切出力しない。
// - 途中で失敗したら即座に停止し、それまでの結果(ID・slug・画像URLのみ、秘密情報なし)を
//   結果ファイルへ書き出す。

import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';

export const CONFIRM_FLAG = '--confirm-microcms-write';

export function hasConfirmFlag(argv) {
  return argv.includes(CONFIRM_FLAG);
}

// front matterのthemeが未設定の2記事は、由山さんの確認(2026-09-06)によりカテゴリを確定済み。
export const CATEGORY_OVERRIDE_BY_SLUG = {
  'what-is-smell': 'olfactory',
  'may-fatigue-type-aroma': 'olfactory',
};

export const THEME_TO_CATEGORY_NAME = {
  aroma: 'アロマテラピー',
  olfactory: '嗅覚反応分析',
  daily: '日々のこと',
};

const REQUIRED_CATEGORY_NAMES = Object.values(THEME_TO_CATEGORY_NAME);

// im-check-chart本文内のこの画像は、Worker側の既存Static Assetsで配信を継続するため、
// アップロード・URL置換の対象にしない(2026-09-06由山さん指摘により確定)。
export const INLINE_IMAGE_UPLOAD_EXCLUSIONS = new Set(['/images/chart-clean.png']);

const MIME_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export function guessMimeType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function inlineImagePaths(html) {
  return [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
}

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
    } else if (extname(entry.name) === '.md' && entry.name !== '_template.md') {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function fileSizeOrNull(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Markdown15記事をmicroCMS投入用データへ変換する(ネットワーク通信なし)。
 * @param {object} options
 * @param {string} options.blogDir - `src/content/blog`の絶対パス。
 * @param {string} options.publicDir - `public`の絶対パス(eyecatch実在確認用)。
 */
export async function collectArticles({ blogDir, publicDir }) {
  const files = await listMarkdownFiles(blogDir);
  const processor = await createMarkdownProcessor({ syntaxHighlight: false });

  const articles = [];
  const errors = [];

  for (const filePath of files) {
    try {
      const source = await readFile(filePath, 'utf8');
      const { frontmatter, content } = parseFrontmatter(source, { frontmatter: 'empty-with-spaces' });
      const rendered = await processor.render(content, {
        fileURL: new URL(`file://${filePath}`),
        frontmatter,
      });

      const slug = frontmatter.slug;
      if (!slug) {
        errors.push({ file: filePath, error: 'slugがfront matterに存在しない' });
        continue;
      }
      if (!frontmatter.pubDate) {
        errors.push({ file: filePath, slug, error: 'pubDateがfront matterに存在しない' });
        continue;
      }

      const themeKey = frontmatter.theme ?? CATEGORY_OVERRIDE_BY_SLUG[slug] ?? null;
      const categoryName = themeKey ? (THEME_TO_CATEGORY_NAME[themeKey] ?? null) : null;

      let eyecatchLocalPath = null;
      let eyecatchAbsolutePath = null;
      if (frontmatter.image) {
        eyecatchLocalPath = frontmatter.image;
        eyecatchAbsolutePath = resolve(publicDir, `.${eyecatchLocalPath}`);
        const size = await fileSizeOrNull(eyecatchAbsolutePath);
        if (size === null) {
          errors.push({ file: filePath, slug, error: `eyecatch画像ファイルが見つからない: ${eyecatchLocalPath}` });
          eyecatchAbsolutePath = null;
        }
      }

      const allInlineImages = inlineImagePaths(rendered.code);
      const inlineImagesExcluded = allInlineImages.filter((src) => INLINE_IMAGE_UPLOAD_EXCLUSIONS.has(src));
      const inlineImagesRequiringUpload = allInlineImages.filter(
        (src) => !INLINE_IMAGE_UPLOAD_EXCLUSIONS.has(src),
      );

      articles.push({
        file: filePath,
        slug,
        title: frontmatter.title ?? null,
        description: frontmatter.description ?? null,
        pubDateIso: new Date(frontmatter.pubDate).toISOString(),
        sourceDraft: frontmatter.draft === true,
        themeKey,
        categoryName,
        eyecatchLocalPath,
        eyecatchAbsolutePath,
        contentHtml: rendered.code,
        inlineImagesRequiringUpload,
        inlineImagesExcluded,
      });
    } catch (error) {
      errors.push({ file: filePath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { articles, errors };
}

function buildContentApiUrl(config, endpoint, extraPath = '') {
  return new URL(`https://${config.serviceDomain}.microcms.io/api/v1/${endpoint}${extraPath}`);
}

function authHeaders(apiKey) {
  return { 'X-MICROCMS-API-KEY': apiKey };
}

/** カテゴリAPIを取得する(読み取り専用)。 */
export async function fetchCategories(config, fetchImpl, categoryEndpoint) {
  const url = buildContentApiUrl(config, categoryEndpoint);
  url.searchParams.set('limit', '100');
  const response = await fetchImpl(url, { headers: authHeaders(config.apiKey) });
  if (!response.ok) {
    throw new Error(`カテゴリ一覧の取得に失敗しました (${response.status})`);
  }
  const data = await response.json();
  return (data.contents ?? []).map((item) => ({ id: item.id, name: item.name }));
}

/**
 * 必要な3カテゴリ(アロマテラピー/嗅覚反応分析/日々のこと)がすべて一意に対応付けられるかを検査する。
 * 対応不明・重複がある場合は例外を投げる(呼び出し側はこの時点で一切の書き込みを行ってはならない)。
 */
export function resolveCategoryIdMap(categories) {
  const byName = new Map();
  for (const category of categories) {
    if (!category.name) continue;
    if (byName.has(category.name)) {
      throw new Error(`カテゴリ名が重複しています: ${category.name}`);
    }
    byName.set(category.name, category.id);
  }

  const missing = REQUIRED_CATEGORY_NAMES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`microCMS側に対応するカテゴリが見つかりません: ${missing.join(', ')}`);
  }

  const result = new Map();
  for (const name of REQUIRED_CATEGORY_NAMES) {
    result.set(name, byName.get(name));
  }
  return result;
}

/**
 * 既存コンテンツをslugで確認する(下書き・公開の両方を対象)。
 *
 * (2026-09-06訂正) 当初はManagement API(contents/{endpoint})を使う設計だったが、
 * 実機確認によりManagement APIの一覧応答にはslug等のカスタムフィールドが一切含まれず
 * (id・status・日時・draftKeyなどのメタ情報のみ)、slugでの重複確認に使えないことが判明した。
 * また`filters`クエリも効かず、常に同一の1件(microCMSの初期サンプル記事)を返してしまい、
 * 全記事が誤って「重複」と判定される不具合があった(書き込み前のdry-runで発見・是正)。
 *
 * 正しくは、通常のContent API(GET /api/v1/{endpoint})へ`status=DRAFT,PUBLISH`を付けて
 * 下書き・公開の両方を対象に`filters=slug[equals]...`で検索する。この方式には、対象APIの
 * 個別権限で「下書きコンテンツの全取得」が別途必要。
 */
export async function checkExistingSlug(config, endpoint, slug, fetchImpl) {
  const url = buildContentApiUrl(config, endpoint);
  url.searchParams.set('filters', `slug[equals]${slug}`);
  url.searchParams.set('status', 'DRAFT,PUBLISH');
  url.searchParams.set('limit', '1');
  url.searchParams.set('fields', 'id,slug');
  const response = await fetchImpl(url, { headers: authHeaders(config.apiKey) });
  if (!response.ok) {
    throw new Error(`既存コンテンツの確認に失敗しました (${response.status})`);
  }
  const data = await response.json();
  const contents = data.contents ?? [];
  return contents.length > 0 ? contents[0] : null;
}

/** POST URLに`status=draft`が付いていることを送信直前に必ず検証する。付いていなければ処理を中止する。 */
export function assertStatusDraft(url) {
  const value = new URL(url).searchParams.get('status');
  if (value !== 'draft') {
    throw new Error(
      `記事作成は必ずstatus=draftを使用する必要があります(検出値: ${value ?? '(未指定)'})。処理を中止します。`,
    );
  }
}

/** eyecatch画像をmicroCMSのメディアAPIへアップロードする(公開・下書きの状態区分は無い)。 */
export async function uploadEyecatch(config, absoluteFilePath, fetchImpl) {
  const buffer = await readFile(absoluteFilePath);
  const fileName = basename(absoluteFilePath);
  const form = new FormData();
  form.set('file', new Blob([buffer], { type: guessMimeType(absoluteFilePath) }), fileName);

  const url = `https://${config.serviceDomain}.microcms-management.io/api/v1/media`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: authHeaders(config.apiKey),
    body: form,
  });
  if (!response.ok) {
    throw new Error(`eyecatch画像のアップロードに失敗しました (${response.status}): ${fileName}`);
  }
  const data = await response.json();
  if (!data.url) {
    throw new Error(`アップロード応答にurlが含まれていません: ${fileName}`);
  }
  return data.url;
}

/** 記事を`status=draft`で作成する。status=draft以外では絶対に送信しない。 */
export async function createArticleDraft(config, endpoint, payload, fetchImpl) {
  const url = buildContentApiUrl(config, endpoint);
  url.searchParams.set('status', 'draft');
  assertStatusDraft(url);

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { ...authHeaders(config.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // 応答本文はログ・結果ファイルへ残らないよう含めない(秘密情報の混入を防ぐため。ステータスコードのみ記録する)。
    throw new Error(`記事作成に失敗しました (${response.status}): ${payload.slug}`);
  }
  const data = await response.json();
  if (!data.id) {
    throw new Error('作成応答にidが含まれていません');
  }
  return data.id;
}

function buildCreatePayload(article, categoryIdMap) {
  const categoryId = article.categoryName ? categoryIdMap.get(article.categoryName) : undefined;
  return {
    title: article.title,
    content: article.contentHtml,
    description: article.description,
    pubDate: article.pubDateIso,
    slug: article.slug,
    ...(categoryId ? { category: categoryId } : {}),
  };
}

async function loadLocalEnv(cwd, target) {
  let source;
  try {
    source = await readFile(resolve(cwd, '.env.local'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    target[key] ??= value;
  }
}

/**
 * 移行結果をファイルへ記録する。APIキー・draftKeyなど秘密情報は一切含めない。
 */
async function writeResultsFile(cwd, results) {
  const dir = resolve(cwd, '.local-backups/microcms-migration');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `migration-result-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(path, `${JSON.stringify(results, null, 2)}\n`);
  return path;
}

/**
 * 移行の本体。
 * @param {object} options
 * @param {string[]} options.argv
 * @param {string} [options.cwd]
 * @param {Record<string,string|undefined>} [options.env]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.blogEndpoint] - microCMSの記事APIエンドポイント名。
 * @param {string} [options.categoryEndpoint] - microCMSのカテゴリAPIエンドポイント名。
 * @param {boolean} [options.loadDotEnvLocal] - `cwd`直下の`.env.local`を読み込むか(既定true)。
 *   自動テストで、実在する`.env.local`の資格情報を意図せず拾わないためにfalseを指定できる。
 */
export async function runMigration({
  argv,
  cwd = process.cwd(),
  env = process.env,
  fetchImpl = fetch,
  blogEndpoint = 'blogs',
  categoryEndpoint = 'categories',
  loadDotEnvLocal = true,
} = {}) {
  const execute = hasConfirmFlag(argv);
  const resolvedEnv = { ...env };
  if (loadDotEnvLocal) {
    await loadLocalEnv(cwd, resolvedEnv);
  }

  const blogDir = resolve(cwd, 'src/content/blog');
  const publicDir = resolve(cwd, 'public');
  const { articles, errors: conversionErrors } = await collectArticles({ blogDir, publicDir });

  const serviceDomain = resolvedEnv.MICROCMS_SERVICE_DOMAIN;
  const apiKey = resolvedEnv.MICROCMS_API_KEY;
  const hasCredentials = Boolean(serviceDomain && apiKey);

  if (execute && !hasCredentials) {
    throw new Error(
      `${CONFIRM_FLAG}が指定されていますが、MICROCMS_SERVICE_DOMAIN/MICROCMS_API_KEYが未設定です。書き込みを中止します。`,
    );
  }

  if (!hasCredentials) {
    // 資格情報が無い場合は、ネットワーク通信を一切行わない変換プレビューのみを返す。
    const plan = articles.map((article) => ({
      slug: article.slug,
      action: 'preview_offline_no_credentials',
      title: article.title,
      categoryName: article.categoryName,
      willUploadEyecatch: Boolean(article.eyecatchAbsolutePath),
      inlineImagesRequiringUpload: article.inlineImagesRequiringUpload,
      inlineImagesExcludedFromUpload: article.inlineImagesExcluded,
    }));
    const resultsPath = await writeResultsFile(cwd, {
      mode: 'offline_preview',
      execute: false,
      generatedAt: new Date().toISOString(),
      conversionErrors,
      plan,
    });
    return { mode: 'offline_preview', execute: false, conversionErrors, plan, resultsPath };
  }

  const config = { serviceDomain, apiKey };

  // カテゴリAPIを事前取得し、対応が取れなければ、いかなる書き込みも行わず停止する。
  const categories = await fetchCategories(config, fetchImpl, categoryEndpoint);
  const categoryIdMap = resolveCategoryIdMap(categories);

  const results = [];
  let stoppedEarly = false;
  let stopReason = null;

  for (const article of articles) {
    if (!article.categoryName) {
      results.push({ slug: article.slug, status: 'skipped_missing_category' });
      continue;
    }

    let existing;
    try {
      existing = await checkExistingSlug(config, blogEndpoint, article.slug, fetchImpl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ slug: article.slug, status: 'failed', error: message });
      stoppedEarly = true;
      stopReason = `slug重複確認に失敗: ${article.slug}`;
      break;
    }

    if (existing) {
      results.push({ slug: article.slug, status: 'skipped_existing', microcmsId: existing.id });
      continue;
    }

    if (!execute) {
      results.push({
        slug: article.slug,
        status: 'planned_create',
        willUploadEyecatch: Boolean(article.eyecatchAbsolutePath),
      });
      continue;
    }

    try {
      let eyecatchUrl;
      if (article.eyecatchAbsolutePath) {
        eyecatchUrl = await uploadEyecatch(config, article.eyecatchAbsolutePath, fetchImpl);
      }

      const payload = buildCreatePayload(article, categoryIdMap);
      if (eyecatchUrl) {
        // (2026-09-06訂正) 実機確認により、このスキーマのeyecatchフィールドは
        // オブジェクト({url: ...})ではなくプレーンな文字列URLを要求することが判明した
        // (オブジェクト形式を送ると`'eyecatch' has unexpected data type.`で400になる)。
        payload.eyecatch = eyecatchUrl;
      }

      const microcmsId = await createArticleDraft(config, blogEndpoint, payload, fetchImpl);
      results.push({
        slug: article.slug,
        status: 'created',
        microcmsId,
        eyecatchUrl: eyecatchUrl ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ slug: article.slug, status: 'failed', error: message });
      stoppedEarly = true;
      stopReason = `記事作成またはeyecatchアップロードに失敗: ${article.slug}`;
      break;
    }
  }

  const resultsPath = await writeResultsFile(cwd, {
    mode: execute ? 'execute' : 'network_dry_run',
    execute,
    generatedAt: new Date().toISOString(),
    conversionErrors,
    categoryIdMap: Object.fromEntries(categoryIdMap),
    results,
    stoppedEarly,
    stopReason,
  });

  if (stoppedEarly) {
    throw new Error(`${stopReason}。結果ファイル: ${resultsPath}`);
  }

  return { mode: execute ? 'execute' : 'network_dry_run', execute, conversionErrors, results, resultsPath };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  try {
    const outcome = await runMigration({ argv: process.argv.slice(2) });
    console.log(`モード: ${outcome.mode}(execute=${outcome.execute})`);
    if (outcome.conversionErrors.length > 0) {
      console.log('変換エラー:', outcome.conversionErrors);
    }
    if (outcome.plan) {
      console.log('プレビュー件数:', outcome.plan.length);
    }
    if (outcome.results) {
      console.log('結果件数:', outcome.results.length);
    }
    console.log(`結果ファイル: ${outcome.resultsPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
