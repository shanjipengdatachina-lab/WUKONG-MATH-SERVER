/* ==========================================================================
   管理后台 · 开发与构建配置
   --------------------------------------------------------------------------
   关键一条：**把 /api 反代到接口服务**。
   这样后台和接口在浏览器看来是**同源**（都是 localhost:5174），于是：
     · 登录 Cookie 是第一方 Cookie，不用处理跨域
     · 不用开 CORS 白名单，也不受 SameSite 那套限制
   生产上是 Nginx 干同一件事（同域反代），所以开发和生产的行为一致。
   ========================================================================== */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
