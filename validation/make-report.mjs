// 把 public/validation/results.json 嵌進報告模板，輸出可分享的單頁報告 public/validation/report.html
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = readFileSync(join(root, 'public/validation/results.json'), 'utf8');
const tpl = readFileSync(join(root, 'validation/report.template.html'), 'utf8');
writeFileSync(join(root, 'public/validation/report.html'), tpl.replace('__DATA__', () => JSON.stringify(JSON.parse(data))));
console.log('wrote public/validation/report.html');
