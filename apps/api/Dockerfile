# ==========================================================================
# 接口服务 · 生产镜像
# ==========================================================================
# ⚠️ 这份 **没有在本机 build 过** —— 这台开发机上没有 Docker（见上线手册的「没验到的部分」）。
#    但里面那三步（装依赖 → prisma generate → tsc 构建 → node dist/main.js）在宿主机上
#    逐一跑过：构建产物能起、探活正常、数据库不可用时干净地 500 而不是崩掉。
#
# 只有一个 stage：够用，而且少一层就少一处没验过的地方。
# 代价是 tsx / typescript 这些开发依赖也在镜像里（多约 200MB）。
# 等真正上线跑稳了再收敛成多段构建，那时有环境可以验。
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# 先只拷"依赖清单"：依赖没变时这一层能命中缓存，之后改一行代码不用重装一遍
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# admin 的清单也要拷：npm 的 workspace 是全量解析的，缺一个 manifest 会直接报错
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspaces --include-workspace-root --include=dev

COPY apps/api ./apps/api
COPY seed ./seed

# Prisma 生成 Client 要用**生产那份 schema**（prisma/schema.prisma，MySQL 版）：
# prisma/dev/ 那份 SQLite 版是本地生成的，不进镜像。
# 这一步**不连数据库**，纯本地生成。
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @wukong-math/api

WORKDIR /app/apps/api
EXPOSE 3000

# 探活直接用现成的 /api/health —— 它自己会连一下数据库，
# 所以"容器是健康的"这句话里包含"数据库连得上"
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 起服务**之前**先把迁移跑到最新：`migrate deploy` 是幂等的，没有新的就什么都不做。
# **迁移失败就不启动** —— 与其带着半截表结构对外服务，不如让容器起不来、看得见。
# `exec` 不能省：不写的话 node 是 sh 的子进程，docker stop 的 SIGTERM 落在 sh 上，
# 进程收不到信号、只能等超时被强杀。
# 这一步靠镜像里那份 prisma CLI（现在在 devDependencies，单段构建所以带着）——
# 以后要是收敛成多段构建，别忘了把它带进去，否则容器起不来。
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && exec node dist/main.js"]
