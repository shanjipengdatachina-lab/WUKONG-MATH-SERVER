/* ==========================================================================
   入口
   --------------------------------------------------------------------------
   `import 'dotenv/config'` 必须留在最前：ESM 按书写顺序求值，
   它先把 .env 读进 process.env，后面的 config.ts 才读得到。
   ========================================================================== */
import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `[api] 已启动 http://localhost:${config.port}  （${config.nodeEnv}）\n` +
      `      探活 /api/health    知识树 /api/tree    接口文档 /docs`,
  );
});
