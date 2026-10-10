import { build } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import TOML from '@iarna/toml';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'static/admin');
const source = path.join(root, 'node_modules/vditor/dist');
const vendor = path.join(output, 'vendor/vditor/dist');
const params = TOML.parse(await readFile(path.join(root, 'config/_default/params.toml'), 'utf8'));
await mkdir(output, { recursive: true });
await rm(path.join(output, 'vendor'), { recursive: true, force: true });
for (const entry of ['index.css', 'css', 'images', 'js/lute', 'js/katex', 'js/highlight.js', 'js/icons/ant.js', 'js/i18n/en_US.js']) {
  const destination = path.join(vendor, entry);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(source, entry), destination, { recursive: true });
}
// Vditor includes an older KaTeX build. Use the maintained direct dependency.
const katex = path.join(root, 'node_modules/katex/dist');
for (const entry of ['katex.min.js', 'katex.min.css', 'fonts']) {
  await cp(path.join(katex, entry), path.join(vendor, 'js/katex', entry), { recursive: true });
}
await cp(path.join(katex, 'contrib/mhchem.min.js'), path.join(vendor, 'js/katex/mhchem.min.js'));
// CMS equations are rendered on the server; public pages need matching styles and fonts.
const publicMath = path.join(root, 'static/cms-math');
await rm(publicMath, { recursive: true, force: true });
await mkdir(publicMath, { recursive: true });
for (const entry of ['katex.min.css', 'fonts']) {
  await cp(path.join(katex, entry), path.join(publicMath, entry), { recursive: true });
}
await build({
  absWorkingDir: root,
  entryPoints: ['cms/admin/appearance.js'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  outfile: path.join(output, 'appearance.js'),
  define: {
    __SITE_DEFAULT_APPEARANCE__: JSON.stringify(params.defaultAppearance || 'light'),
    __SITE_AUTO_APPEARANCE__: JSON.stringify(params.autoSwitchAppearance ?? true),
  },
});
await build({
  absWorkingDir: root,
  entryPoints: ['cms/admin/app.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: path.join(output, 'app.js'),
  legalComments: 'eof',
});
console.log('Built the admin studio with local editor assets.');
