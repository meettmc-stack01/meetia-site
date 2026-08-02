export const BLOG_THEMES = {
  aroma: 'アロマテラピー',
  olfactory: '嗅覚反応分析',
  daily: '日々のこと',
} as const;

export type BlogTheme = keyof typeof BLOG_THEMES;

export const BLOG_THEME_IDS = Object.keys(BLOG_THEMES) as BlogTheme[];

export function isBlogTheme(value: string): value is BlogTheme {
  return value in BLOG_THEMES;
}

export function themeLabel(theme: BlogTheme): string {
  return BLOG_THEMES[theme];
}
