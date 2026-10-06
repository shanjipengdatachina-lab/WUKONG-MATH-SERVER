/* ==========================================================================
   从 prisma/schema.prisma 生成一份**本地开发用的 SQLite 版**
   --------------------------------------------------------------------------
   为什么不手写两份 schema：两份迟早会不一致，生成的不会。
   规则只有两条：
     ① 数据源 provider  mysql → sqlite
     ② 去掉 MySQL 专有的 @db.* 原生类型（SQLite 不认）
   生成物落在 prisma/dev/schema.prisma，**别手改**（下次生成会覆盖）。
   用法：npm run db:dev
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(API, 'prisma/schema.prisma');
const OUT_DIR = path.join(API, 'prisma/dev');
const OUT = path.join(OUT_DIR, 'schema.prisma');

const raw = fs.readFileSync(SRC, 'utf8');

const swapped = raw.replace(/(provider\s*=\s*)"mysql"/, '$1"sqlite"');
if (swapped === raw) {
  console.error('[dev-schema] 没找到 provider = "mysql" —— schema 被改过了？先看一眼再跑');
  process.exit(1);
}

/* @db.VarChar(191) / @db.LongText / @db.Text ... SQLite 都不认，一律去掉 */
const body = swapped.replace(/\s*@db\.\w+(\([^)]*\))?/g, '');

const header = `/* ==========================================================================
   ⚠️ 这个文件是**自动生成**的，不要手改！
   源头：prisma/schema.prisma（MySQL 版，那份才是真的）
   生成：node tools/dev-schema.mjs    （或 npm run db:dev）
   ========================================================================== */
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, header + body, 'utf8');
console.log(`[dev-schema] 已生成 ${path.relative(API, OUT)}（provider 换成 sqlite）`);
