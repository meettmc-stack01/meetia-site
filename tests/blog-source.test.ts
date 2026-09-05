import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContentSourcePriority, selectBlogSource } from '../src/lib/blogSource.ts';

test('環境変数未設定は安全側のmarkdownになる', () => {
  assert.equal(resolveContentSourcePriority(undefined), 'markdown');
});

test('"microcms"以外の値(誤設定含む)はすべてmarkdownへフォールバックする', () => {
  assert.equal(resolveContentSourcePriority(''), 'markdown');
  assert.equal(resolveContentSourcePriority('markdown'), 'markdown');
  assert.equal(resolveContentSourcePriority('MICROCMS'), 'markdown');
  assert.equal(resolveContentSourcePriority('microcms '), 'markdown');
});

test('"microcms"は明示的にmicrocms優先として認識される', () => {
  assert.equal(resolveContentSourcePriority('microcms'), 'microcms');
});

test('priority=markdown(移行・照合中)では、microCMSの内容に関係なくMarkdownだけを採用する', () => {
  const markdownPosts = [{ slug: 'a', value: 'markdown-a' }, { slug: 'b', value: 'markdown-b' }];
  const microCmsPosts = [{ slug: 'z', value: 'microcms-z' }];

  const selected = selectBlogSource(markdownPosts, microCmsPosts, 'markdown');

  assert.deepEqual(
    selected.map((entry) => entry.slug),
    ['a', 'b'],
  );
});

test('priority=microcms(移行完了後)では、Markdownの内容に関係なくmicroCMSだけを採用する', () => {
  const markdownPosts = [{ slug: 'a', value: 'markdown-a' }];
  const microCmsPosts = [{ slug: 'a', value: 'microcms-a' }, { slug: 'c', value: 'microcms-c' }];

  const selected = selectBlogSource(markdownPosts, microCmsPosts, 'microcms');

  assert.deepEqual(
    selected.map((entry) => entry.slug),
    ['a', 'c'],
  );
  assert.equal(selected[0].value, 'microcms-a');
});

test('priority=microcmsでは、公開終了・未移行でmicroCMSに存在しないMarkdown記事は一覧へフォールバックしない(復活しない)', () => {
  const markdownPosts = [
    { slug: 'still-published', value: 'markdown-still-published' },
    { slug: 'unpublished-in-microcms', value: 'markdown-unpublished' },
  ];
  const microCmsPosts = [{ slug: 'still-published', value: 'microcms-still-published' }];

  const selected = selectBlogSource(markdownPosts, microCmsPosts, 'microcms');

  assert.deepEqual(
    selected.map((entry) => entry.slug),
    ['still-published'],
  );
  assert.equal(
    selected.some((entry) => entry.slug === 'unpublished-in-microcms'),
    false,
  );
});

test('priority=microcmsで、microCMS取得結果が0件(全記事が公開終了・未移行)なら、Markdownの記事も一切表示しない', () => {
  const markdownPosts = [
    { slug: 'a', value: 'markdown-a' },
    { slug: 'b', value: 'markdown-b' },
  ];

  const selected = selectBlogSource(markdownPosts, [], 'microcms');

  assert.deepEqual(selected, []);
});

test('priority=markdownでは、microCMSにしか無い新規記事も表示しない(Markdownが完全な正本)', () => {
  const selected = selectBlogSource(
    [{ slug: 'existing', value: 'markdown-existing' }],
    [{ slug: 'new-in-microcms', value: 'microcms-new' }],
    'markdown',
  );

  assert.deepEqual(
    selected.map((entry) => entry.slug),
    ['existing'],
  );
});
