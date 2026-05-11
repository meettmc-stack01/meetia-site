import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    draft: z.boolean().default(false),
    image: z.string().optional(),
    slug: z.string().optional(),
  }),
});

export const collections = { blog };
