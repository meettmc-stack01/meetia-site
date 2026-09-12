export type ContentSourcePriority = 'markdown' | 'microcms';

/**
 * 環境変数からの生値をパースする。'microcms'以外(未設定・誤値を含む)は
 * すべて安全側の'markdown'として扱う。移行・照合が終わるまでの既定値。
 */
export function resolveContentSourcePriority(rawValue: string | undefined): ContentSourcePriority {
  return rawValue === 'microcms' ? 'microcms' : 'markdown';
}

/**
 * 2段階の完全切替専用。どちらか一方のソースだけを、その時点の完全な正本として採用する。
 *
 * - priority='markdown'(既定・移行・照合中): Markdownだけを表示する。microCMSの内容は一切参照しない。
 * - priority='microcms'(移行完了後): microCMSだけを完全な正本として表示する。
 *   Markdown側にしか残っていない記事(未移行・公開終了を含む)は、たとえ存在してもフォールバック表示しない。
 *   これにより、microCMSで公開終了にした記事がMarkdownから復活することはない。
 *
 * microCMS取得の成否そのもの(API障害時にビルドを失敗させるか等)はこの関数の責務ではなく、
 * 呼び出し側がgetResolvedPublishedArticlesの例外をそのまま伝播させることで扱う。
 */
export function selectBlogSource<M, C>(
  markdownPosts: M[],
  microCmsPosts: C[],
  priority: ContentSourcePriority,
): M[] | C[] {
  return priority === 'microcms' ? microCmsPosts : markdownPosts;
}
