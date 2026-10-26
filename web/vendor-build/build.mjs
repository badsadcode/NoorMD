// Produces the offline vendor bundle used by the desktop app.
// Output: ../../src/NoorMD/wwwroot/vendor (committed to the repository).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'src', 'NoorMD', 'wwwroot', 'vendor');
const nm = join(here, 'node_modules');
mkdirSync(join(out, 'toastui', 'theme'), { recursive: true });
mkdirSync(join(out, 'dompurify'), { recursive: true });
mkdirSync(join(out, 'inter', 'files'), { recursive: true });
mkdirSync(join(out, 'licenses'), { recursive: true });

await build({
  entryPoints: [join(here, 'entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome110'],
  legalComments: 'eof',
  outfile: join(out, 'toastui', 'toastui-editor-all.min.js'),
});

const tui = join(nm, '@toast-ui', 'editor', 'dist');
cpSync(join(tui, 'toastui-editor.css'), join(out, 'toastui', 'toastui-editor.css'));
cpSync(join(tui, 'theme', 'toastui-editor-dark.css'), join(out, 'toastui', 'theme', 'toastui-editor-dark.css'));
cpSync(join(nm, 'dompurify', 'dist', 'purify.min.js'), join(out, 'dompurify', 'purify.min.js'));

// Inter (variable) — Latin + Latin Extended covers English, Polish and most European diacritics.
const interFiles = join(nm, '@fontsource-variable', 'inter', 'files');
const faces = [];
for (const subset of ['latin', 'latin-ext']) {
  for (const style of ['normal', 'italic']) {
    const file = `inter-${subset}-wght-${style}.woff2`;
    cpSync(join(interFiles, file), join(out, 'inter', 'files', file));
    faces.push(`@font-face{font-family:'Inter Variable';font-style:${style};font-display:swap;font-weight:100 900;src:url(files/${file}) format('woff2-variations');}`);
  }
}
writeFileSync(join(out, 'inter', 'inter.css'), faces.join('\n') + '\n');

// License texts for everything that ends up in the bundle.
const licenses = {
  'toast-ui-editor.LICENSE.txt': ['@toast-ui/editor/LICENSE', join(here, 'licenses', 'toast-ui-editor.LICENSE.txt')],
  'dompurify.LICENSE.txt': ['dompurify/LICENSE'],
  'inter.OFL.txt': ['@fontsource-variable/inter/LICENSE'],
  'prosemirror.LICENSE.txt': ['prosemirror-model/LICENSE'],
};
for (const [name, candidates] of Object.entries(licenses)) {
  const found = candidates.map(c => (c.startsWith(here) ? c : join(nm, c))).find(existsSync);
  if (!found) throw new Error('License file missing for ' + name);
  writeFileSync(join(out, 'licenses', name), readFileSync(found));
}
console.log('Vendor bundle written to', out);
