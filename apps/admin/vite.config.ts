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

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  /* 生产挂在 /admin/ 下面（Nginx 同域反代），开发仍在根路径。
     不设这个 base 的话，构建出来的 index.html 会去要 /assets/xxx.js ——
     而那个路径在生产上属于学生端，后台直接白屏，报的还是个看不出原因的 404。
     开发那边不跟着改，是因为 dev server 会跑到 localhost:5174/admin/ 去，跟现在的习惯不一样。 */
  base: command === 'build' ? '/admin/' : '/',
  build: { outDir: 'dist', sourcemap: false },
}));
