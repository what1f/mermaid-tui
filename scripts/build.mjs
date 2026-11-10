// 把共用的 core/ 和依赖里的 pele 复制进各 harness 的插件目录。
// Claude Code 装插件时只复制插件自己的目录，引用不到仓库里的 core/，所以复制出来的文件要提交；
// CI 会重跑这一步，检查提交的和源头一致。
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const pele = dirname(require.resolve('pele/package.json'));
const { version } = JSON.parse(readFileSync(join(pele, 'package.json'), 'utf8'));

const hooks = join(root, 'claude-code/hooks');
mkdirSync(join(hooks, 'core'), { recursive: true });
mkdirSync(join(hooks, 'vendor'), { recursive: true });

for (const file of readdirSync(join(root, 'core')).filter((f) => f.endsWith('.ts'))) {
  const code = readFileSync(join(root, 'core', file), 'utf8');
  writeFileSync(join(hooks, 'core', file), `// 由 core/${file} 复制而来，改那边，再跑 pnpm build\n${code}`);
}

// pele/ascii 自带整个 pele：SVG 的 render 和字符图的 renderAscii 都从它来
const code = readFileSync(join(pele, 'dist/ascii.js'), 'utf8');
writeFileSync(join(hooks, 'vendor/pele.mjs'), `// pele ${version}, https://github.com/what1f/pele (MIT, see pele.LICENSE)\n${code}`);
copyFileSync(join(pele, 'LICENSE'), join(hooks, 'vendor/pele.LICENSE'));
copyFileSync(join(root, 'core/pele.d.mts'), join(hooks, 'vendor/pele.d.mts'));

console.log(`core + pele ${version} -> claude-code/hooks/`);
