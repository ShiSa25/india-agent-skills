/** SPEC §0.6 fallback when `npx skills-ref validate` is not pinned. */
import { lintFrontmatterOnly } from './validate-skills.mjs';

const errors = lintFrontmatterOnly();
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log('validate-frontmatter: ok');
