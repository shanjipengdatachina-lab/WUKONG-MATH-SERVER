<template>
  <div class="login">
    <el-card class="login__card">
      <h1 class="login__title">悟空数学 · 管理后台</h1>
      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="账号">
          <el-input v-model="form.username" placeholder="admin" data-qa="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password data-qa="password" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" :loading="loading" class="login__btn" data-qa="submit" @click="submit">登录</el-button>
      </el-form>
      <p v-if="error" class="login__err" data-qa="error">{{ error }}</p>
      <p class="login__hint">演示账号：admin / wk-admin-2026</p>
    </el-card>
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
.login { min-height: 100vh; display: grid; place-items: center; background: #0b0e14; }
.login__card { width: 360px; padding: 8px; }
.login__title { margin: 4px 0 20px; font-size: 18px; font-weight: 600; }
.login__btn { width: 100%; }
.login__err { margin: 12px 0 0; color: var(--el-color-danger); font-size: 13px; }
.login__hint { margin: 14px 0 0; color: #909399; font-size: 12px; }
</style>
