import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes.code || []), ['className', /^language-./, 'math-inline', 'math-display']],
  },
};

// Raw HTML is discarded; KaTeX runs after sanitization and never trusts HTML commands.
const renderer = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
  .use(remarkRehype).use(rehypeSanitize, schema)
  .use(rehypeKatex, { trust: false, strict: 'warn', throwOnError: false, maxExpand: 500, maxSize: 20 })
  .use(rehypeStringify);

export async function renderMarkdown(markdown) {
  return String(await renderer.process(markdown));
}

export function referencedMedia(markdown) {
  const ids = new Set();
  for (const match of markdown.matchAll(/\/media\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.webp\b/g)) ids.add(match[1]);
  return [...ids];
}
