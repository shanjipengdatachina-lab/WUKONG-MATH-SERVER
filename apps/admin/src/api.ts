/* ==========================================================================
   接口调用 · 一处管住 401 与 403
   --------------------------------------------------------------------------
   401 = 没登录 / 登录失效 → 去登录页（记住原来要去哪）
   403 = 登录了但没权限 → **弹一句人话，不跳登录页**
        （跳了会让人以为是自己没登录，然后反复输密码，其实只是权限不够）
   ========================================================================== */

/* 接口前缀。开发期 Vite 把 /api 反代到 :3000，生产是 Nginx 同域反代 ——
   两边都是同源，所以这里一个相对路径就够（Cookie 也因此是第一方的）。 */
export const API_BASE = '/api';

export type ApiError = { status: number; code: string; message: string };

export type Me = {
  id: number; username: string; nickname: string;
  grade: string | null; role: string; perms: string[];
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !headers['Content-Type']) { headers['Content-Type'] = 'application/json'; }

  let res: Response;
  try {
    /* 后台是**改数据**的地方：任何一层缓存都可能让"改完界面不变"。
       带 no-store 让浏览器每次都问服务端 —— 实测不过这一关的话，
       /api/tree 的 max-age=300 会让改完的节点在界面上五分钟不出现。 */
    res = await fetch(API_BASE + path, { ...init, headers, credentials: 'include', cache: 'no-store' });
  } catch (e) {
    throw { status: 0, code: 'NETWORK', message: '连不上接口服务，确认它起了没有' } as ApiError;
  }

  if (res.status === 204) { return undefined as T; }

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  if (!res.ok) {
    const b = body as { error?: { code?: string; message?: string } } | null;
    throw {
      status: res.status,
      code: b?.error?.code ?? 'UNKNOWN',
      message: b?.error?.message ?? `接口回了 ${res.status}`,
    } as ApiError;
  }
  return body as T;
}

/* ---- 当前登录的人：一个极小的响应式容器，够了就不引状态库 ---- */
import { reactive } from 'vue';

export const auth = reactive({
  user: null as Me | null,
  loaded: false,
});

export async function loadMe(): Promise<void> {
  try {
    auth.user = await api<Me>('/me');
  } catch {
    auth.user = null;
  } finally {
    auth.loaded = true;
  }
}

export function can(perm: string): boolean {
  return !!auth.user && auth.user.perms.indexOf(perm) >= 0;
}
