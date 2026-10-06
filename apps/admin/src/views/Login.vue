<template>
  <div class="login">
    <div class="login__panel">
      <section class="login__left">
        <div class="login__brand">
          <span class="login__mark" aria-hidden="true">悟</span>
          <span>悟空数学 · 管理后台</span>
        </div>
        <p class="login__slogan">章节、图谱、时间轴读的是同一份知识树 —— 这里改一次，三处一起变。</p>
        <ul class="login__facts">
          <li><b>1391</b><span>知识树节点</span></li>
          <li><b>1660</b><span>卡片</span></li>
          <li><b>3</b><span>演示学生</span></li>
        </ul>
      </section>

      <section class="login__right">
        <h1 class="login__title">登录</h1>
        <p class="login__sub">用管理账号登录，能看到用户与内容；学生账号只能看内容。</p>

        <el-form label-position="top" @submit.prevent="submit">
          <el-form-item label="账号">
            <el-input v-model="form.username" placeholder="admin" size="large" data-qa="username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              show-password
              size="large"
              placeholder="请输入密码"
              data-qa="password"
              @keyup.enter="submit"
            />
          </el-form-item>
          <p v-if="error" class="login__err" role="alert" data-qa="error">{{ error }}</p>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            class="login__btn"
            data-qa="submit"
            @click="submit"
          >登录</el-button>
        </el-form>

        <p class="login__hint">
          演示账号：<code>admin</code> / <code>wk-admin-2026</code> ·
          <code>student</code> / <code>wk-demo-2026</code>
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, auth, type ApiError, type Me } from '../api';

const form = reactive({ username: '', password: '' });
const loading = ref(false);
const error = ref('');
const router = useRouter();
const route = useRoute();

async function submit(): Promise<void> {
  if (!form.username || !form.password) { error.value = '账号和密码都要填'; return; }
  loading.value = true;
  error.value = '';
  try {
    auth.user = await api<Me>('/auth/login', { method: 'POST', body: JSON.stringify(form) });
    auth.loaded = true;
    await router.replace((route.query.returnTo as string) || '/');
  } catch (e) {
    error.value = (e as ApiError).message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(1100px 480px at 12% 0%, #e7f2ed 0%, rgba(231, 242, 237, 0) 62%),
    var(--admin-canvas);
}

.login__panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 392px;
  width: min(920px, 100%);
  background: var(--admin-surface);
  border: 1px solid var(--admin-line);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(16, 18, 21, 0.07);
  overflow: hidden;
}

/* ---- 左边：品牌那一栏 ---- */
.login__left {
  padding: 40px 36px;
  background: linear-gradient(160deg, #0e7a4f 0%, #0b623f 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
}
.login__brand { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
.login__mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 15px;
}
.login__slogan {
  margin: 26px 0 0;
  font-size: 15px;
  line-height: 1.9;
  color: rgba(255, 255, 255, 0.9);
  max-width: 24em;
}
.login__facts {
  margin: auto 0 0;
  padding: 22px 0 0;
  list-style: none;
  display: flex;
  gap: 30px;
  border-top: 1px solid rgba(255, 255, 255, 0.22);
}
.login__facts b { display: block; font-size: 22px; font-weight: 600; }
.login__facts span { font-size: 12px; color: rgba(255, 255, 255, 0.78); }

/* ---- 右边：表单 ---- */
.login__right { padding: 40px 36px; }
.login__title { margin: 0; font-size: 20px; font-weight: 600; color: var(--admin-ink); }
.login__sub { margin: 8px 0 24px; font-size: 13px; line-height: 1.7; color: var(--admin-ink-2); }
.login__btn { width: 100%; margin-top: 4px; }

.login__err {
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px solid #fbc4c4;
  border-radius: 8px;
  background: #fef0f0;
  color: #c0362c;
  font-size: 13px;
}

.login__hint { margin: 22px 0 0; font-size: 12px; line-height: 1.9; color: var(--admin-ink-3); }
.login__hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f4f5f7;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 860px) {
  .login__panel { grid-template-columns: minmax(0, 1fr); }
  .login__left { padding: 28px 24px; }
  .login__facts { margin-top: 22px; }
  .login__right { padding: 28px 24px; }
}
</style>
