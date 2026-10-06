#!/usr/bin/env sh
# ==========================================================================
# MySQL 备份（在**宿主机**上跑，不是容器里）
# ==========================================================================
# 用法：放进 crontab，每天凌晨 3 点：
#     crontab -e
#     0 3 * * * REPO_DIR=/srv/wukong-math-server sh /srv/wukong-math-server/deploy/backup-mysql.sh >> /var/log/wukong-backup.log 2>&1
#
# ⚠️ 备份**必须试过恢复**才算数。上线手册里有一条"随便找一份备份，恢复到一个临时库，
#    数一下节点数对不对"—— 没试过的备份只是让人安心的文件。
#
# 为什么 --single-transaction：InnoDB 下它能给出一个**一致的快照**而不锁表，
# 也就是说备份的时候学生照样能用。加 --quick 是别把结果集全塞进内存。
# ==========================================================================
set -eu

REPO_DIR="${REPO_DIR:-/srv/wukong-math-server}"
BACKUP_DIR="${BACKUP_DIR:-/srv/wukong-backup}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ENV_FILE="$REPO_DIR/deploy/.env.production"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/wukong-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# 库名与账号从**同一个** env 文件里取：另抄一份就会出现"备份的是另一个库"
# shellcheck disable=SC1090
. "$ENV_FILE"

cd "$REPO_DIR"
docker compose --env-file "$ENV_FILE" exec -T db \
  mysqldump \
    --single-transaction --quick --routines --events \
    --default-character-set=utf8mb4 \
    -u"${MYSQL_USER:-wukong}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE:-wukong_math}" \
  | gzip > "$OUT"

# 空文件说明 mysqldump 其实失败了（管道会把退出码吞掉，所以这里看大小）
if [ ! -s "$OUT" ] || [ "$(gzip -dc "$OUT" | head -c 1 | wc -c)" -eq 0 ]; then
  echo "[backup] $OUT 是空的 —— 这次备份没成，别删旧的" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" -name 'wukong-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "[backup] 完成 $OUT（保留最近 $KEEP_DAYS 天）"
