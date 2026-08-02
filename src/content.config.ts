import { defineCollection, z } from 'astro:content';
import { BLOG_THEME_IDS } from './lib/blogThemes';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    draft: z.boolean().default(false),
    image: z.string().optional(),
    slug: z.string().optional(),
    /** アロマテラピー / 嗅覚反応分析 / 日々のこと。リテイク待ちなどは未設定でよい */
    theme: z.enum(BLOG_THEME_IDS).optional(),
  }),
});

export const collections = { blog };
