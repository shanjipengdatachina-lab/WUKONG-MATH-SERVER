/* ==========================================================================
   孤儿上传图清理
   --------------------------------------------------------------------------
   学生传了图、又没提交那张切片（点取消 / 关掉页面 / 传错了重传），图就落在盘上没人管了。
   `DELETE /me/exam-slices/:id` 那一处只清"**这张切片自己引用的**那几张"，
   碰不到这些从来没进过库的文件 —— 实测本地 dev 库里：盘上 7 张，只 2 张有引用。

   这个活只干一件事：**盘上没有任何切片引用的图，扫出来删掉。**

   四条不能破的规矩：

     ① **只认我们自己生成的形状**（`YYYY/MM/<18 位十六进制>.jpg|png|webp`）。
        删文件比"拒收一个路径"危险得多 —— 认不出来的一律不碰。
        宁可漏扫一个不认识的形状，也不能误删别人放进这个目录里的东西。
        （这一条比 storage.service 的 `absOf` **更严**：那里判的是"接不接受这个入参"，
          这里判的是"能不能从盘上删掉"，两者该严的程度不一样。）

     ② **给足宽限期**（默认 24 小时）。**库里没有引用 ≠ 没人要**：
        学生正开着表单、图传上去了还没点提交，这一刻它就是个"孤儿"，
        这时候删掉等于把人刚传的东西弄丢。宽限期专门挡这一种。

     ③ **先查库、再读目录**。顺序反过来的话，两次之间新提交的切片
        会被当成孤儿删掉（它的行还没进库）。引用集一次读全，不做逐文件查询。

     ④ **删不掉不算失败**：库里没变、盘上留一个文件，比整个任务崩掉好。
        下一轮还会扫到它。

   跑法：
     · 定期：`main.ts` 起一个定时器（`UPLOAD_SWEEP_MINUTES` 定间隔，0 = 不起）
     · 手动：`npm run uploads:sweep`（**只看不删**）/ `npm run uploads:sweep -- --apply`
   ========================================================================== */
import { readdirSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { uploadsRoot } from './storage.service.js';

/** 规矩 ①：`saveImage` 生成的就是这个形状，别的一律不动 */
const OURS = /^(\d{4})\/(\d{2})\/([0-9a-f]{18})\.(jpg|png|webp)$/;

const HOUR_MS = 60 * 60 * 1000;
const SAMPLE_LIMIT = 20;

export type SweepResult = {
  /** 盘上认出来的（我们生成的）文件数 */
  scanned: number;
  /** 其中库里还有引用的 */
  referenced: number;
  /** 是孤儿、但还没过宽限期，这一轮不动 */
  young: number;
  /** 删掉的（dryRun 时是"会删的"） */
  removed: number;
  freedBytes: number;
  /** 删不掉的（占用 / 权限）—— 下一轮再来 */
  failed: number;
  dryRun: boolean;
  /** 前 20 个相对路径，给日志看 */
  sample: string[];
};

function human(bytes: number): string {
  if (bytes < 1024) { return bytes + 'B'; }
  if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(0) + 'KB'; }
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

/** 盘上所有"我们生成的"文件。目录形状就是 `YYYY/MM/文件`，不做自由递归 —— 认不准的不进去 */
function listOurs(root: string): { rel: string; mtimeMs: number; size: number }[] {
  const out: { rel: string; mtimeMs: number; size: number }[] = [];
  let years: string[] = [];
  try {
    years = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
      .map((d) => d.name);
  } catch {
    /* 目录还没建起来（storage.service 会建，这里是"起得更早"的兜底） */
    return out;
  }

  for (const y of years) {
    const months = readdirSync(path.join(root, y), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{2}$/.test(d.name))
      .map((d) => d.name);
    for (const m of months) {
      for (const f of readdirSync(path.join(root, y, m), { withFileTypes: true })) {
        if (!f.isFile()) { continue; }
        const rel = `${y}/${m}/${f.name}`;
        if (!OURS.test(rel)) { continue; }
        const abs = path.join(root, rel);
        try {
          const st = statSync(abs);
          out.push({ rel, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          /* 刚被别人删掉了（一轮里两个进程同时在扫）—— 当它不在 */
        }
      }
    }
  }
  return out;
}

export async function sweepOrphanUploads(opts: { minAgeMs: number; dryRun?: boolean }): Promise<SweepResult> {
  const dryRun = opts.dryRun === true;

  /* 规矩 ③：先查库 */
  const rows = await prisma.examSliceImage.findMany({ select: { file: true } });
  const used = new Set(rows.map((r) => r.file));

  const files = listOurs(uploadsRoot);
  const now = Date.now();
  const res: SweepResult = {
    scanned: files.length, referenced: 0, young: 0,
    removed: 0, freedBytes: 0, failed: 0, dryRun, sample: [],
  };

  for (const f of files) {
    if (used.has(f.rel)) { res.referenced += 1; continue; }
    /* 规矩 ②：还没老到能确定"没人要了" */
    if (now - f.mtimeMs < opts.minAgeMs) { res.young += 1; continue; }

    if (!dryRun) {
      try {
        await unlink(path.join(uploadsRoot, f.rel));
      } catch {
        res.failed += 1;   /* 规矩 ④ */
        continue;
      }
    }
    res.removed += 1;
    res.freedBytes += f.size;
    if (res.sample.length < SAMPLE_LIMIT) { res.sample.push(f.rel); }
  }

  return res;
}

function report(r: SweepResult, minAgeMs: number): void {
  const head = `[uploads] 孤儿图清理${r.dryRun ? '（只看不删）' : ''}：` +
    `盘上 ${r.scanned} 张（有引用 ${r.referenced}／太新跳过 ${r.young}）` +
    `／${r.dryRun ? '该删' : '删了'} ${r.removed} 张（${human(r.freedBytes)}）` +
    (r.failed ? `／删不掉 ${r.failed} 张` : '');
  console.log(head);
  if (r.sample.length) {
    const more = r.removed > r.sample.length ? ` …还有 ${r.removed - r.sample.length} 张` : '';
    console.log(`         ${r.sample.join(' ')}${more}`);
  }
  if (r.dryRun && r.removed) {
    console.log(`         宽限期 ${minAgeMs / HOUR_MS} 小时；要真删就加 --apply`);
  }
}

/**
 * 起一个定期活。**不在启动那一刻扫** —— 磁盘遍历不该挡在"开始监听"前面。
 * 间隔 <= 0 就不起（测试、或者把活挪去别处时用）。
 */
export function startUploadSweep(): void {
  const minutes = config.storage.sweepMinutes;
  if (!(minutes > 0)) {
    console.log('[uploads] 孤儿图清理没起（UPLOAD_SWEEP_MINUTES=0）');
    return;
  }
  const minAgeMs = config.storage.sweepMinAgeHours * HOUR_MS;

  const tick = async (): Promise<void> => {
    try {
      report(await sweepOrphanUploads({ minAgeMs }), minAgeMs);
    } catch (e) {
      /* 清理失败绝不能把进程带下去 —— 它是个后台活，不是主流程 */
      console.error('[uploads] 孤儿图清理失败：', e);
    }
  };

  /* unref()：定时器不替进程"续命"，该关就关得掉 */
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, minutes * 60 * 1000).unref();
  console.log(`[uploads] 孤儿图清理已起：每 ${minutes} 分钟一次，宽限期 ${config.storage.sweepMinAgeHours} 小时`);
}

/* --------------------------------------------------------------------------
   手动跑：`tsx src/modules/uploads/sweep.service.ts`（默认只看不删）
          `… --apply` 真删
   -------------------------------------------------------------------------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dryRun = !process.argv.includes('--apply');
  const minAgeMs = config.storage.sweepMinAgeHours * HOUR_MS;

  sweepOrphanUploads({ minAgeMs, dryRun })
    .then((r) => {
      report(r, minAgeMs);
      console.log(`         上传目录：${uploadsRoot}`);
    })
    .catch((e) => {
      console.error('[uploads] 失败：', e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
