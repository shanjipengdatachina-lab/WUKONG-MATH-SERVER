/* ==========================================================================
   图片存储
   --------------------------------------------------------------------------
   落在 `config.storage.dir`（开发期 `./var/uploads`，生产换 OSS 时只改那一行配置）。

   三件事在这里定死，别处不许绕过去：
     ① **类型看字节，不看 Content-Type。** 后者是调用方自己写的，想写什么都行；
        只认 JPEG / PNG / WebP 的魔数。
     ② **文件名服务端生成**（日期目录 + 随机名 + 按魔数定的扩展名）。
        前端传来的任何名字都不进路径 —— 否则 `../../etc/passwd` 这类就是往任意位置写文件。
     ③ **只存相对路径**，库里也是相对路径。这样换存储根目录、换 OSS 都不用改库。
   ========================================================================== */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';

/** 上传根目录（绝对路径）。进程起来时就把目录建好：第一次写盘失败最难查。 */
export const uploadsRoot = path.resolve(config.storage.dir);
mkdirSync(uploadsRoot, { recursive: true });

export type ImageKind = 'jpg' | 'png' | 'webp';

/**
 * 从**字节**判断这是什么图。
 * JPEG: FF D8 FF ／ PNG: 89 50 4E 47 0D 0A 1A 0A ／ WebP: "RIFF"…"WEBP"
 * 认不出来就回 null —— 不认识的字节一律不收。
 */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) { return 'jpg'; }
  if (buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) { return 'png'; }
  if (buf.length >= 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WEBP') { return 'webp'; }
  return null;
}

/** 相对路径 → 能直接给前端的地址（生产由 Nginx 把 /uploads 反代到接口） */
export function publicUrl(rel: string): string {
  return '/uploads/' + rel;
}

/** 存的相对路径 → 绝对路径。**只接受我们自己生成的那种形状**，别的一律拒。 */
export function absOf(rel: string): string | null {
  if (!/^\d{4}\/\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(rel)) { return null; }
  return path.join(uploadsRoot, rel);
}

export type SavedImage = { file: string; url: string; bytes: number; kind: ImageKind; sha256: string };

/** 收一张图。类型不对直接抛（调用方翻成 400）。 */
export async function saveImage(buf: Buffer): Promise<SavedImage> {
  const kind = sniffImage(buf);
  if (!kind) {
    throw new Error('只收 JPEG / PNG / WebP —— 而且看的是文件开头的字节，不是 Content-Type');
  }
  if (!buf.length) { throw new Error('收到的是空文件'); }

  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const dir = `${d.getFullYear()}/${p(d.getMonth() + 1)}`;
  const name = `${randomBytes(9).toString('hex')}.${kind}`;
  const rel = `${dir}/${name}`;

  mkdirSync(path.join(uploadsRoot, dir), { recursive: true });
  await writeFile(path.join(uploadsRoot, rel), buf);

  return {
    file: rel,
    url: publicUrl(rel),
    bytes: buf.length,
    kind,
    /* 存一份哈希：同一张图被传两次能认出来（也方便核对有没有串图） */
    sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16),
  };
}
