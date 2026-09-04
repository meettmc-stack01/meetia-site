export function includeDrafts(): boolean {
  return process.env.CF_PAGES_BRANCH === 'cms-draft';
}

export function isVisiblePost(post: { data: { draft?: boolean } }): boolean {
  return includeDrafts() || !post.data.draft;
}
