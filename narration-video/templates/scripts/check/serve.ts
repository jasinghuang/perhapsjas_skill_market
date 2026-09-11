/**
 * serve：无头门禁**进程内自起 Vite**（M3b Task 7）。
 *
 * 为什么自起而不是"探活 5174 上的 dev server 就用"（计划 I2/#1-I3 的实测教训）：
 *   1. 本机 5174 上**常常是别人的项目**的 dev server——探活即复用会静默检查错误的项目，
 *      报告却是绿的（最坏的一种门禁失效：假绿且无人察觉）；
 *   2. CI 里根本没有已运行的 dev server。
 * 故：**默认永不复用外部服务**；只有显式 `--url`（headless.ts 的 opts.url）才复用。
 *
 * 两条实测踩坑（不是风格偏好，写在这里防回归）：
 *   · **不要传 `server: { port: 0 }`**：实测它会**覆盖 vite.config.ts 的 5174** 并回落 5173
 *     ——门禁查的还是这个项目，但端口与文档/脚本约定悄悄不一致。正确姿势是**只**传
 *     `server: { hmr: false }`（HMR 关闭 = 门禁期间页面不得被热更新打断；其余 server 配置
 *     交给配置文件），端口被占时 Vite 自己 +1（strictPort 默认 false）。
 *   · **`resolvedUrls` 必须断言非空再取**：`server.listen()` 之后 `resolvedUrls` 仍可能是
 *     `null`（Vite 的类型就是这么标的），直接取 `local[0]` 会静默传出 `undefined`，
 *     下游 `withHeadless(undefined)` 会炸在离真因很远的地方。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

export interface ServeOptions {
  /** 项目根（Vite root；默认 = 脚本所在模板根 scripts/check/../..） */
  repoRoot?: string;
  /** 配置文件（默认 <repoRoot>/vite.config.ts；不存在则不传，交 Vite 自身查找） */
  configFile?: string;
}

export interface ServeHandle {
  /** 实际监听的基址（端口被占时是 Vite 自动 +1 后的那个） */
  url: string;
  stop(): Promise<void>;
}

/**
 * 起一个进程内 Vite dev server 并返回其实际 URL。失败路径**自己收尾**（关了再抛）——
 * 调用方拿不到 handle，没人能替它关。
 */
export async function startServe(opts: ServeOptions = {}): Promise<ServeHandle> {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const configFile = opts.configFile ?? path.join(repoRoot, "vite.config.ts");
  // 延迟 import：纯函数/编排单测不为这个模块拉起整个 Vite（与 session.ts 延迟 import
  // playwright 同款取舍——只有真要起服务时才加载）。
  const { createServer } = await import("vite");
  const server = await createServer({
    root: repoRoot,
    ...(fs.existsSync(configFile) ? { configFile } : {}),
    // ⚠ 不传 port（见文件头实测踩坑 1）；logLevel warn：门禁报告要干净（自起的 URL 由调用方打印）
    server: { hmr: false },
    logLevel: "warn",
  });
  try {
    await server.listen();
    const urls = server.resolvedUrls;
    if (urls === null || urls.local.length === 0) {
      throw new Error(
        "Vite 已 listen 但 resolvedUrls 为空——拿不到可访问的 URL（端口/协议/主机配置异常）；" +
          "拒绝把 undefined 当作基址传下去",
      );
    }
    return { url: urls.local[0], stop: () => server.close() };
  } catch (e) {
    await server.close().catch(() => undefined);
    throw e;
  }
}
