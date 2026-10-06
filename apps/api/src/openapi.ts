/* ==========================================================================
   Swagger（OpenAPI）—— **从 zod 生成，不许手写**
   --------------------------------------------------------------------------
   这是选了 Express 之后要自己立的规矩之一（设计稿 §7.1）：Express 不带文档能力，
   手写 swagger 注释的结局必然是"代码改了、文档没改"，半年就烂。
   所以：路由用 zod 描述出入参 → 文档由这个 registry 生成 → 一份 schema 同时管校验和文档。
   ========================================================================== */
import { OpenApiGeneratorV3, OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { config } from './config.js';

/* 这一行必须在**任何 schema 被注册之前**执行：它给 zod 的每个类型挂上 .openapi()。
   漏掉的报错是 `zodSchema.openapi is not a function`，看着像库坏了，其实只是没初始化。
   放在这里而不是各路由里：模块被 import 时就会跑，早于任何 registerPath。 */
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: '悟空数学 · 后台接口',
      version: config.version,
      description: '本文档由 zod schema 生成（见 src/openapi.ts），**不要手工编辑**。',
    },
    servers: [{ url: '/' }],
  });
}
