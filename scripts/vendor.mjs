// 把 node_modules 里的前端库拷贝到 public/vendor，前端自托管、不依赖外部 CDN。
// 升级 marked / dompurify 后运行：npm run vendor
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/marked/marked.min.js', 'public/vendor/marked.min.js'],
  ['node_modules/dompurify/dist/purify.min.js', 'public/vendor/purify.min.js'],
];

mkdirSync(resolve(root, 'public/vendor'), { recursive: true });
for (const [from, to] of files) {
  copyFileSync(resolve(root, from), resolve(root, to));
  console.log(`${from} -> ${to}`);
}
