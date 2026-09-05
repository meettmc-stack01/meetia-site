import sanitizeHtml from 'sanitize-html';

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'h2',
      'h3',
      'h4',
      'strong',
      'em',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'figure',
      'figcaption',
      'img',
      'hr',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
    },
    transformTags: {
      a: (_tagName, attribs) => {
        const external = /^https?:\/\//i.test(attribs.href ?? '');
        return {
          tagName: 'a',
          attribs: external
            ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
            : attribs,
        };
      },
    },
  });
}
