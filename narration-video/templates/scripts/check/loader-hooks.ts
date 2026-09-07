/**
 * loader-hooks：tsx（node）运行时资源加载钩子（终审 M-6——资产 import 最大崩溃面修复）。
 *
 * 背景：tsx（node）不能解析 Vite 默认的 `import hero from "./hero.png"`——
 * node 对 .png 等未知扩展名抛 ERR_UNKNOWN_FILE_EXTENSION 裸栈，真实项目章节一旦
 * 引入本地资产，npm run check 的 manifest 动态 import 链（manifest → 章节组件 →
 * 资产）整链崩溃。本钩子在 load 阶段拦截：
 *   - .css        → 文本默认导出（?raw 与副作用 import 皆通；Ruling P4-6 的 fs 方案
 *                   之外，contract-lint 的 ?raw 链仍需此钩子）
 *   - .png/.svg/.jpg/.jpeg → 占位空字符串。门禁不渲染页面，资产内容无意义——
 *                   真渲染由 Vite 管线负责（Vite 的 import 写法返回资源 URL，占位串
 *                   仅保证门禁 import 链不崩）
 *   - .json       → 解析真实内容默认导出（import x from "./x.json" 的 Vite 写法在
 *                   node 下同样无原生加载器；解析真值防章节模块作用域读字段崩溃）
 *   其余扩展名交还默认加载器（nextLoad）。
 *
 * 边界：resolve 阶段（文件不存在 → ERR_MODULE_NOT_FOUND）不拦截——缺失资产是真实
 * 错误，CLI 入口的 try/catch 将其转可读报告（见 check-fast formatCrashMessage）。
 *
 * registerHooks 需 Node ≥ 22.15——package.json engines 已声明该下限（engines 是
 * npm 在安装期唯一能提示 Node 版本的机制；package.json 不能写注释，说明记于此）。
 * 仅非 vitest 环境注册：vitest 走 Vite 管线原生支持，且钩子会干扰测试管线。
 *
 * 纯 TS、无 DOM 依赖——tsx（node）与 vitest 双环境消费（vitest 下注册为 no-op）。
 */

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CSS_EXT_RE = /\.css$/i;
const IMAGE_EXT_RE = /\.(?:png|svg|jpe?g)$/i;
const JSON_EXT_RE = /\.json$/i;

/**
 * 资产/样式模块源码生成（纯函数——vitest 可直接单测）。返回 undefined = 不在
 * 本钩子覆盖范围（交还默认加载器）。
 */
export function assetModuleSource(url: string): string | undefined {
  if (!url.startsWith("file:")) return undefined;
  const clean = url.split("?")[0]; // ?raw 等 query 剥离后按扩展名判定
  if (CSS_EXT_RE.test(clean)) {
    return `export default ${JSON.stringify(readFileSync(fileURLToPath(clean), "utf8"))}`;
  }
  if (IMAGE_EXT_RE.test(clean)) {
    // 占位空字符串：门禁不渲染页面，资产内容无意义（真渲染由 Vite 管线负责）
    return `export default ""`;
  }
  if (JSON_EXT_RE.test(clean)) {
    // 解析真实内容：章节模块作用域读字段的代码不因占位假值崩溃
    return `export default JSON.parse(${JSON.stringify(readFileSync(fileURLToPath(clean), "utf8"))})`;
  }
  return undefined;
}

/** 注册 load 钩子（模块副作用调用一次；vitest 环境为 no-op）。 */
export function registerLoaderHooks(): void {
  if (process.env.VITEST) return;
  if (typeof registerHooks !== "function") {
    throw new Error(
      "loader-hooks：node:module.registerHooks 不可用（需 Node ≥ 22.15）——tsx 运行需资产/样式钩子加载 React 链",
    );
  }
  registerHooks({
    load(url, context, nextLoad) {
      const source = assetModuleSource(url);
      if (source !== undefined) {
        return { format: "module", source, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

registerLoaderHooks();
