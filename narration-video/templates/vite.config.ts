import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { createExportService } from "./vite-plugins/export-service";
import type { RenderArgs } from "./scripts/render"; // type-only：esbuild 打包配置时擦除（见 loadRenderChain）

/**
 * 懒加载真渲染编排（`scripts/render.ts`）——**不能**写成字面量的相对 import（实测踩平）：
 *
 * Vite 用 esbuild **打包** vite.config.ts 之后再加载它，而打包器会**跟进**相对路径的字面量
 * import / dynamic-import：渲染链会把 `src/chapters/manifest` 的样式链（`import "./x.css"` 与
 * `?raw`）拖进这次打包，esbuild 当场报
 * `Cannot import …css into a JavaScript file without an output path configured`
 * ——配置加载失败 = dev server 起不来（连带 vitest 也起不来）。
 *
 * 故两件事缺一不可：
 *   ① specifier 是**变量**（打包器不跟进，运行期才解析）：锚点用 `import.meta.url`——Vite 的配置
 *      打包会按**源文件**逐个注入它（实测注入的是 vite.config.ts 自己的 file URL），故
 *      `<模板根>/scripts/render.ts` 在打包前后都算得对；
 *   ② 运行期交给 **tsx** 的 loader：`.ts` + 无扩展名 import 只有 TS 运行器能解，而 tsx 是本模板的
 *      devDependency（`npm run render` 用的也是它——同一条链、同一份 loader-hooks 语义）。
 */
let renderChain: Promise<typeof import("./scripts/render")> | undefined;
function loadRenderChain(): Promise<typeof import("./scripts/render")> {
  renderChain ??= (async () => {
    const { register } = await import("tsx/esm/api"); // 裸 specifier：由 Node 解析（不经配置打包）
    register();
    const url = new URL("./scripts/render.ts", import.meta.url).href;
    return (await import(url)) as typeof import("./scripts/render");
  })();
  return renderChain;
}

// ── 导出服务（M5b Task 5，§9「页面按钮 → 本地渲染服务」） ──
//
// 作业体 = 真渲染编排 `runRender` 包一层（`ExportJob.run()` 返回产物 + 退出码——**不复用**
// runRender 之名，两者返回值不同型）。渲染链**只在真被点"导出"时才加载**（懒加载见上）。
const exportService = createExportService({
  job: {
    async run() {
      const { runRender, DEFAULT_OUT_DIR } = await loadRenderChain();
      const { stageConfig } = await import("./src/engine/runtime-config");
      const outDir = DEFAULT_OUT_DIR;
      const args: RenderArgs = {
        outDir,
        mockAudio: false, // 导出渲的是**盘上现有的**音轨（用户/CLI 已经合成过）
        realisticAudio: false,
        concurrency: 2, // 每个 worker 一个浏览器进程——本机负载常高，别开大
        only: undefined,
        verifyDeterminism: false, // 按钮点一下的等待里塞不进双渲对比
        help: false,
      };
      const startedAtMs = Date.now();
      const code = await runRender(args, {
        onProgress: (done, total) => exportService.reportProgress(done, total),
      });

      // 交付物挑选：确定性成片与降级产物（T4）**可能同时在盘上**——降级时那份 `<slug>.mp4` 是
      // **未通过自校验**的（编码早于自校验），T4 明写"别让下游（导出服务/人）把它当交付物"。
      // 判据 = 本次起点之后出现过 `.realtime.mp4`（出现即降级发生了，它才是交付物）。
      const deterministic = path.join(outDir, `${stageConfig.slug}.mp4`);
      const realtime = path.join(outDir, `${stageConfig.slug}.realtime.mp4`);
      const fresh = fs.existsSync(realtime) && fs.statSync(realtime).mtimeMs >= startedAtMs;
      return { file: fresh ? realtime : deterministic, code };
    },
  },
});

export default defineConfig({
  plugins: [react(), exportService.plugin],
  // 只监听回环：导出服务的同源闸门（`vite-plugins/export-service.ts` 的 Host 判定）以此为前提。
  // 与 Vite 缺省一致（host 默认 'localhost'），写出来是为了不让这条安全前提被无声改掉。
  server: { port: 5174, host: "localhost" },
  test: {
    environment: "jsdom",
    // 终审 C1：必须显式 css: true。vitest 缺省 css: false 会把 CSS 模块
    // （含 ?raw 导入）stub 成空串，contract-lint 扫 14 个空串恒绿（假绿）。
    css: true,
    // Node 26 全局自带实验性 localStorage（未启用时为 undefined），vitest 2 的
    // populateGlobal 因此过滤掉 jsdom 的 localStorage，改用 VM 池直接在 jsdom
    // 上下文运行，localStorage/sessionStorage 等窗口存储可用。
    pool: "vmForks",
    setupFiles: ["src/test-setup.ts"],
  },
});
