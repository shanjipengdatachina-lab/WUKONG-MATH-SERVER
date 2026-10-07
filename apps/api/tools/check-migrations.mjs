/* ==========================================================================
   迁移体检：**schema.prisma 里的表 ↔ prisma/migrations 里建/删的表** 对不对得上
   --------------------------------------------------------------------------
   为什么要有它：有迁移体系之后，最容易出的事就是"改了 schema、忘了写迁移"——
   本地 `db:dev`（SQLite + db push）照样跑得好好的，一路到生产 `migrate deploy`
   才发现少一张表。这两边**都是一行 SQL 与一份 DSL**，不连数据库就能对账。

   它查四件事：
     ① `migration_lock.toml` 在、且 provider 是 mysql
     ② 迁移目录名是 `\d{14}_小写名`（顺序靠它，名字乱了顺序就乱了）
     ③ schema 里每个 model 的**表名**都在迁移里被建过
     ④ 迁移里建出来的表都能在 schema 里找到（没有多余的）

   **它管不了什么**：列、索引、外键、默认值的**逐字**差异它看不出来 ——
   那一步要 `prisma migrate diff --from-migrations … --to-schema-datamodel …`，
   而那个命令**需要一个影子库**（真 MySQL）。这台开发机上没有 MySQL，
   所以那一步留在一台能连 MySQL 的机器上做（见 prisma/migrations/README.md）。
   ========================================================================== */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const prismaDir = path.resolve(here, '../prisma');
const schemaFile = path.join(prismaDir, 'schema.prisma');
const migrationsDir = path.join(prismaDir, 'migrations');
const lockFile = path.join(migrationsDir, 'migration_lock.toml');

const problems = [];
const note = (ok, text) => console.log(`${ok ? '✓' : '✗'} ${text}`);

/* ---- ① 锁文件 ---- */
let lockOk = false;
if (!existsSync(lockFile)) {
  problems.push('缺 prisma/migrations/migration_lock.toml —— 迁移体系还没建起来');
} else {
  const lock = readFileSync(lockFile, 'utf8');
  const m = /provider\s*=\s*"([^"]+)"/.exec(lock);
  lockOk = !!m && m[1] === 'mysql';
  if (!lockOk) {
    problems.push(`migration_lock.toml 里的 provider 是「${m ? m[1] : '（没写）'}」，应该是 mysql`);
  }
}
note(lockOk, 'migration_lock.toml：provider = mysql');

/* ---- ② 迁移目录 ---- */
const dirs = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((n) => statSync(path.join(migrationsDir, n)).isDirectory())
  : [];
if (!dirs.length) {
  problems.push('prisma/migrations 里一个迁移都没有 —— 生产库建不出来');
}
const nameOk = dirs.every((n) => /^\d{14}_[a-z0-9_]+$/.test(n));
if (!nameOk) {
  problems.push(`迁移目录名不对（要 \d{14}_小写名，顺序靠它）：${
    dirs.filter((n) => !/^\d{14}_[a-z0-9_]+$/.test(n)).join(' ')}`);
}
const sorted = dirs.slice().sort();
note(nameOk && dirs.length > 0, `迁移目录 ${dirs.length} 个，命名与顺序可用`);
console.log(`   ${sorted.join('\n   ')}`);

/* ---- 建/删过的表 ---- */
const built = new Set();
for (const d of sorted) {
  const sql = readFileSync(path.join(migrationsDir, d, 'migration.sql'), 'utf8');
  /* DROP 也要认：删过的表不能算"还在" */
  for (const line of sql.split('\n')) {
    const c = /^CREATE TABLE `([^`]+)`/.exec(line.trim());
    if (c) { built.add(c[1]); continue; }
    const x = /^DROP TABLE `([^`]+)`/.exec(line.trim());
    if (x) { built.delete(x[1]); }
  }
}

/* ---- schema 里的表名（model 名，或它自己的 @@map）---- */
const schema = readFileSync(schemaFile, 'utf8');
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
  .map((m) => {
    const map = /@@map\("([^"]+)"\)/.exec(m[2]);
    return { model: m[1], table: map ? map[1] : m[1] };
  });
if (!models.length) { problems.push('schema.prisma 里没读到任何 model —— 解析规则可能跟不上了'); }

/* ---- ③ schema 有、迁移里没建 ---- */
const missing = models.filter((m) => !built.has(m.table));
if (missing.length) {
  problems.push('schema 里有、迁移里没建过的表（改了 schema 忘了写迁移？）：\n     ' +
    missing.map((m) => `${m.table}（model ${m.model}）`).join('\n     '));
}
note(missing.length === 0, `schema 的 ${models.length} 张表都在迁移里建过`);

/* ---- ④ 迁移有、schema 里没有 ---- */
const known = new Set(models.map((m) => m.table));
const extra = [...built].filter((t) => !known.has(t));
if (extra.length) {
  problems.push(`迁移建了、schema 里没有的表：${extra.join(' ')}`);
}
note(extra.length === 0, '迁移里没有 schema 认不出来的多余表');

/* ---- 汇总 ---- */
console.log();
if (problems.length) {
  console.log(`== 迁移体检：${problems.length} 个问题 ==`);
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log('（列 / 索引 / 外键的逐字差异这里看不出来 —— 那一步要连得上 MySQL，见 prisma/migrations/README.md）');
  process.exitCode = 1;
} else {
  console.log('== 迁移体检：通过 ==');
  console.log('（表级对得上；列 / 索引 / 外键的逐字差异要连 MySQL 才查得了）');
}
