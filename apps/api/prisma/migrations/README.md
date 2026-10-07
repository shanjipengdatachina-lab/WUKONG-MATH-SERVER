# 数据库迁移（prisma/migrations）

生产是 **MySQL 8**，改表走 Prisma Migrate。这份文件只说一件事：
**什么时候用 `db push`、什么时候必须写迁移。**

## 两条路，别混

| | 本地开发 | 生产 / 线上库 |
| --- | --- | --- |
| 库 | SQLite（`prisma/dev/dev.db`） | MySQL 8 |
| schema | `prisma/dev/schema.prisma`（由 `tools/dev-schema.mjs` 从主 schema 生成） | `prisma/schema.prisma`（**唯一源头**） |
| 改表怎么落地 | `npm run db:dev` → `prisma db push` | `prisma migrate deploy`（读这个目录） |
| 有没有历史 | 没有，也不需要有 | **有**，就是 `migrations/` 里那些 |

SQLite 那份**不走迁移**（`db push` 直接对齐，快、而且本来就没有"线上数据"要保）。
所以：`db:dev` 跑得通 **不代表** 迁移是对的 —— 这两件事由 `db:migrate:check` 在中间对账。

## 改一张线上表，按这四步走

```bash
# 1) 只改 prisma/schema.prisma（别手改 prisma/dev/ 那份，下次生成会被覆盖）
# 2) 本地把 SQLite 对齐，好接着写代码
npm run db:dev
# 3) 生成迁移（**这一步需要一台连得上 MySQL 的机器**，见下面「这台机器上没有 MySQL」）
npm run db:migrate -w @wukong-math/api -- --name 加个什么字段
# 4) 对账 + 提交
npm run db:migrate:check
```

（第 3 步写成 `-w @wukong-math/api --` 这种啰嗦样子是有原因的：`--name` 必须透到
`prisma` 那一层；根目录直接 `npm run db:migrate -- --name x` 会被外层 npm 吃掉这个参数。）

第 3 步会：连 MySQL → 在一个**影子库**上把已有迁移重放一遍 → 跟 schema 比 →
把差的那部分写成新迁移 SQL → 应用到你的开发库上。

## 这台机器上没有 MySQL —— 所以第 3 步现在跑不了

开发机没有 MySQL、也没有 Docker（见 `docker-compose.yml` 顶上那段）。
所以 `migrate dev` 在这里**会直接报连不上** —— 这不是配置错了，是环境本来就没有。

那这个目录里的 `*_init` 是怎么来的？用 `migrate diff` 生成的 ——
**它不需要连库**，因为它比的是"空库"和"schema 文件"：

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

也就是说：**基线是可信的**（39 张表，逐字 MySQL DDL），
但"以后每一张表怎么改"这件事，必须在**有 MySQL 的机器上**按上面那四步做。
什么时候有：第一次真正上线那台机器上（M7 部署），或者你自己装个 MySQL。

## 已经有数据的库怎么接上迁移体系

如果某个库是**以前用 `db push` 建的**（表都在、但没有迁移历史），
直接 `migrate deploy` 会报"表已存在"。这时候把基线**标成已应用**就行：

```bash
npx prisma migrate resolve --applied 20261007230502_init
```

（现在还没有这样的库 —— 生产库还没建起来。这条是留给"万一"的。）

## 体检：`npm run db:migrate:check`

不连数据库，只对账 **`schema.prisma` 里的表 ↔ `migrations` 里建/删过的表**：

- 查 `migration_lock.toml` 在不在、provider 是不是 mysql
- 查迁移目录名是不是 `\d{14}_小写名`（**顺序靠它**，名字乱了顺序就乱了）
- 查 schema 里每个 model 的表名都在迁移里建过（**"改了 schema 忘了写迁移"就是这一步抓到的**）
- 查迁移里没有 schema 认不出来的多余表

**它管不了什么**：列 / 索引 / 外键 / 默认值的**逐字**差异它看不出来。
那一步要 `--from-migrations`，而它**需要一个影子库**（真 MySQL）。
所以在没 MySQL 的机器上，这个体检是"表级"的，不是"逐字"的 —— **别把它当全绿**。

## 生产容器里是怎么跑的

`apps/api/Dockerfile` 的 CMD 是：

```
npx prisma migrate deploy && exec node dist/main.js
```

- 起服务**之前**先把迁移跑到最新；`migrate deploy` 幂等，没新的就什么都不做。
- 迁移失败就**不启动** —— 与其带着半截表结构对外服务，不如让容器起不来、看得见。
- `exec` 不能省：不写的话 node 是 sh 的子进程，`docker stop` 的 SIGTERM 落在 sh 上，
  进程收不到、只能等超时被强杀。
- 这一步靠镜像里那份 **prisma CLI**（现在它在 devDependencies 里，单段构建所以带着）。
  以后要是收敛成多段构建，**别忘了把它带进去**，否则容器起不来。
