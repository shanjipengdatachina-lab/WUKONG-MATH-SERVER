/* ==========================================================================
   入口
   --------------------------------------------------------------------------
   `import 'dotenv/config'` 必须留在最前：ESM 按书写顺序求值，
   它先把 .env 读进 process.env，后面的 config.ts 才读得到。
   ========================================================================== */
import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';
import { startUploadSweep } from './modules/uploads/sweep.service.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `[api] 已启动 http://localhost:${config.port}  （${config.nodeEnv}）\n` +
      `      探活 /api/health    知识树 /api/tree    接口文档 /docs`,
  );

  /* 后台的定期活跟在**监听之后**起：起步的活不该参与"服务起没起来"这件事。
     为什么放进程里而不是 cron：部署只有一个容器（见 deploy/），
     而这件事只是扫一个目录 + 一次库查询，够不上另开一个进程的量级。 */
  startUploadSweep();
});
