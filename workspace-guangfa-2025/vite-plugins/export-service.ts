/**
 * export-service.ts（M5b Task 5）：导出服务——**页面按钮 → 本地渲染服务**（§9 的"导出"控制）。
 *
 * ## 形态：Vite 中间件（**同源**），不是独立进程（质检实测钉死的唯一形态）
 *
 * "独立进程 + 临时端口 + 页面在 5174"那套组合**不自洽**（逐条实测）：跨源（`localhost:5174` →
 * `127.0.0.1:<port>`，连主机名写法不同都算跨源）、`/status` 轮询读不到响应体（缺
 * `Access-Control-Allow-Origin`）、加自定义头就触发 OPTIONS 预检；而"邻近端口探测"在本仓是被
 * 明令禁止过的模式（`scripts/check/serve.ts`：5174 上**常常是别人的项目**，且起 Vite 时端口被占
 * 会自动 +1——"页面在 5174"这个前提本身不成立）。走 `configureServer` 的
 * `server.middlewares.use("/__export", …)` 则：**同源** ⇒ 无 CORS、无预检、无端口发现（端口就是
 * 页面自己的），正好满足 §9 的"随 dev server 启动"，也只在本机回环上（Vite 缺省 host=localhost）。
 *
 * ## 三条路由（页面侧字面量在 `src/engine/Stage.tsx` 的 `EXPORT_ROUTES`）
 *
 *   GET  /__export/status → 200 `{ state, progress:{done,total}, message? }`（状态机唯一读数）
 *   POST /__export/run    → 202 触发一次；已有一次在跑 → 409（不排队、不重入、不覆盖）
 *   GET  /__export/file   → 200 最近一次**成功**的产物（`Content-Disposition: attachment`）；
 *                           没有（未导出 / 最近一次失败）→ 404
 *
 * 状态机：idle →（POST）running → done / failed（失败带 message）。done/failed 之后可以再 POST
 * （重新导出）；**running 期间第二次 POST 一律 409**。
 *
 * ## 安全：同源闸门（两道，逐条都有实际攻击面）
 *
 *   ① `Host` 必须是回环（`localhost` / `127.0.0.0/8` / `[::1]`）——挡 **DNS rebinding**：
 *      攻击者把 `evil.example.com` 解析到 127.0.0.1，此时请求的 Host 就是攻击者域名（脚本改不了
 *      Host，但域名解析可以），回环判定把它挡在门外；
 *   ② 带了 `Origin` 时必须与本次请求**同源**——挡"别的网页 fetch 过来触发一次渲染"：跨源请求
 *      浏览器必发 Origin（同源 POST 也发，故合法路径照样过）。本服务**不发任何 CORS 头**：
 *      跨源读不到响应体，但"触发"本身是真实风险，故拦在入口。
 *
 * ## 只 dev 生效
 *
 * 插件 `apply: "serve"`（`vite build` 不加载本插件 ⇒ 生产构建里没有这组路由，也没有渲染能力）。
 * 装配在 `vite.config.ts`：作业体 = `runRender` 包一层——`ExportJob.run()` 返回**产物 + 退出码**，
 * 与 `runRender` 的返回值（退出码）不同型，故**不复用它的名字**。
 *
 * 依赖方向：本模块只依赖 node 内建 + vite 的类型面（`import type`）；**不 import 渲染链**
 * （作业由 `vite.config.ts` 注入，单测注入假作业）——故单测能真起一个 Vite 而完全不碰浏览器/ffmpeg。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

/** 挂载点（页面侧 `EXPORT_ROUTES` 与它同源；契约测试两端各自钉死） */
export const EXPORT_MOUNT = "/__export";

export type ExportStateName = "idle" | "running" | "done" | "failed";

export interface ExportProgress {
  done: number;
  total: number;
}

export interface ExportStatus {
  state: ExportStateName;
  progress: ExportProgress;
  /** failed = 失败原因；done = 产物名（页面直接显示给人看） */
  message?: string;
}

/**
 * 注入面（与 `runRender` 的区别是**名字和返回**）：`run()` 返回**产物路径 + 退出码**。
 * `code !== 0` 视为失败（退出码 1 = 未通过自校验；那种情况下盘上可能留着一份**未通过校验**的成片，
 * 不得当交付物交给用户）。
 */
export interface ExportJob {
  run(): Promise<{ file: string; code: number }>;
}

export interface ExportServiceOptions {
  job: ExportJob;
  /**
   * 挂载点（缺省 `EXPORT_MOUNT`）。**契约测试不用它**：页面常量（`EXPORT_ROUTES`）才是契约，
   * 让测试改挂载点等于把"契约"降级成"实现的自述"——页面改不改名都绿。
   */
  mount?: string;
}

export interface ExportService {
  /** 挂到 `vite.config.ts` 的 plugins 数组 */
  plugin: Plugin;
  /** 渲染作业的上报口（接 `RenderDeps.onProgress`）：只有 running 期间收（见实现） */
  reportProgress(done: number, total: number): void;
  /** 当前状态（读数面；页面走 HTTP，这里给测试/诊断） */
  status(): ExportStatus;
}

// ── 同源闸门（纯判定，无 IO） ──

/** `Host` 头里的主机部分（IPv6 带方括号；其余一刀切掉端口）。 */
function hostNameOf(hostHeader: string): string {
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]");
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  }
  const colon = hostHeader.lastIndexOf(":");
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

/** 回环主机判定：`localhost` / `127.0.0.0/8` / `::1`。 */
function isLoopbackHost(hostHeader: string): boolean {
  const name = hostNameOf(hostHeader);
  return (
    name === "localhost" ||
    name === "::1" ||
    name === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(name)
  );
}

/**
 * 同源判定：通过 → null；拒绝 → 原因（进 403 的体，给排障的人看）。
 * 两道闸门见文件头——`Host` 必须回环；带了 `Origin` 就必须与 Host 同源。
 */
function sameOriginVerdict(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (typeof host !== "string" || host === "") {
    return "缺少 Host——导出服务只服务本机回环页面";
  }
  if (!isLoopbackHost(host)) {
    return `Host ${host} 不是回环地址——导出服务只服务本机页面（挡 DNS rebinding）`;
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "") {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return `Origin ${origin} 不是合法来源`;
    }
    if (originHost !== host) {
      return `Origin ${origin} 与本次请求的 Host ${host} 不同源——跨源触发一律拒绝`;
    }
  }
  return null;
}

// ── 响应面 ──

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store"); // 状态读数被缓存 = 页面看到过期进度
  res.end(text);
}

/** ASCII 回退名：非 ASCII / 引号 / 反斜杠一律换成 `_`（header 值只许可见 ASCII）；空则兜通用名。 */
function asciiFallbackName(name: string): string {
  const safe = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return safe.trim() === "" ? "download.mp4" : safe;
}

/** RFC 5987 的 ext-value：`encodeURIComponent` 不够——它不转义 `'` `(` `)` `*`，而 attr-char 不含它们。 */
function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `Content-Disposition` 的附件头（RFC 6266）。
 *
 * **非 ASCII 名字必须走 `filename*`**（T5 修复轮 1，评审 I-1 的实测缺陷）：node 的 header 值是
 * latin1 口径，`setHeader("content-disposition", 'attachment; filename="演示片.mp4"')` 直接抛
 * `ERR_INVALID_CHAR` ⇒ `/file` 变成 **500 空体**；而 `/status` 照旧正常，故障只在取片那一下暴露。
 * 中文 slug 是**正常用法**（`scripts/scaffold.sh` 的用法文案写的就是 `--slug 项目名`）。
 *
 * 形态：`attachment; filename="<ASCII 回退名>"; filename*=UTF-8''<percent-encoded 原名>`
 * ——现代浏览器取 `filename*`（原文件名保住），不认识 `filename*` 的客户端退回 ASCII 回退名
 * （扩展名保住，至少知道是什么文件）。名字本来就是 ASCII 安全时**只发 `filename=`**：
 * 与修复前的字节形态一致，不制造无谓差异。
 */
function contentDisposition(file: string): string {
  const name = path.basename(file);
  const fallback = asciiFallbackName(name);
  if (fallback === name) return `attachment; filename="${fallback}"`;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${rfc5987Encode(name)}`;
}

// ── 服务 ──

export function createExportService(opts: ExportServiceOptions): ExportService {
  const mount = opts.mount ?? EXPORT_MOUNT;

  let state: ExportStateName = "idle";
  let progress: ExportProgress = { done: 0, total: 0 };
  let message: string | undefined;
  /** 最近一次**成功**产物的绝对路径（只有 done 态才有；失败/新一轮开始时清掉） */
  let deliverable: string | undefined;

  const status = (): ExportStatus => (message === undefined ? { state, progress } : { state, progress, message });

  /** 跑作业并把结果落成状态机的一态（自己吞异常——它跑在 HTTP 请求之外）。 */
  async function runJob(): Promise<void> {
    try {
      const result = await opts.job.run();
      if (result.code !== 0) {
        state = "failed";
        deliverable = undefined;
        message = `渲染退出码 ${result.code}（未通过自校验 / 执行失败）`;
        return;
      }
      if (!fs.existsSync(result.file)) {
        state = "failed";
        deliverable = undefined;
        message = `渲染报成功但产物不在：${result.file}`;
        return;
      }
      state = "done";
      deliverable = result.file;
      message = path.basename(result.file);
    } catch (e) {
      state = "failed";
      deliverable = undefined;
      message = e instanceof Error ? e.message : String(e);
    }
  }

  /** `Content-Disposition` 的附件头（RFC 6266；非 ASCII 名字的形态见 `contentDisposition`）。 */
  function serveFile(res: ServerResponse): void {
    if (state !== "done" || deliverable === undefined || !fs.existsSync(deliverable)) {
      sendJson(res, 404, { error: "没有可取的产物（未导出 / 最近一次导出失败）", ...status() });
      return;
    }
    const file = deliverable;
    res.statusCode = 200;
    res.setHeader("content-type", "video/mp4");
    res.setHeader("content-length", String(fs.statSync(file).size));
    res.setHeader("content-disposition", contentDisposition(file));
    res.setHeader("cache-control", "no-store"); // 下一次导出是另一条片
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy()); // 读一半坏了：断连（不能让调用方以为拿到了完整的）
    stream.pipe(res);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const denied = sameOriginVerdict(req);
    if (denied !== null) {
      sendJson(res, 403, { error: denied });
      return;
    }
    // connect 挂 `use(mount, …)` 时已剥掉前缀：这里看到的 route 是 "/status" 这样
    const route = (req.url ?? "/").split("?")[0];
    const method = req.method ?? "GET";

    if (route === "/status" && method === "GET") {
      sendJson(res, 200, status());
      return;
    }
    if (route === "/run" && method === "POST") {
      if (state === "running") {
        sendJson(res, 409, { error: "已有一次导出在跑（不排队、不重入）", ...status() });
        return;
      }
      state = "running";
      progress = { done: 0, total: 0 };
      message = undefined;
      deliverable = undefined; // 新一轮开始即收回上一轮的产物（别把旧片当本次结果交出去）
      void runJob();
      sendJson(res, 202, status());
      return;
    }
    if (route === "/file" && method === "GET") {
      serveFile(res);
      return;
    }
    // 挂载点之下的未知路径**不往下传**：落到 Vite 的 SPA fallback 会回一个 200 text/html，
    // 调用方会误读成"服务在、只是没这个接口"（状态探活的形状守卫正是防这个）。
    const known = route === "/status" || route === "/run" || route === "/file";
    if (known) {
      sendJson(res, 405, { error: `${method} ${route} 不支持（allowed: ${
        route === "/status" ? "GET" : route === "/run" ? "POST" : "GET"
      }）` });
      return;
    }
    sendJson(res, 404, { error: `未知路由 ${route}（挂载点 ${mount}）` });
  }

  return {
    plugin: {
      name: "narration-video:export-service",
      // 只 dev 生效：生产构建（vite build）不加载本插件 ⇒ 没有这组路由，也没有渲染能力
      apply: "serve",
      configureServer(server: ViteDevServer) {
        server.middlewares.use(mount, handle);
      },
    },
    reportProgress(done: number, total: number) {
      // 只有 running 期间收：作业结束后迟到的读数不该覆盖终态的进度读数
      if (state !== "running") return;
      progress = { done, total };
    },
    status,
  };
}
