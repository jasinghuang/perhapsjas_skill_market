/**
 * export-service.test.ts（M5b Task 5）：导出服务的 **HTTP 契约**测试——真 Vite
 * （`createServer` + `server.listen`）+ 真 `fetch` 打本机回环口。
 *
 * ## 为什么必须真起 Vite（而不是直接调 handler）
 *
 * 本服务的形态就是它的一半契约（质检 #2 I4 钉死的形态）：**同源中间件**挂
 * `server.middlewares.use("/__export", …)`——同源 ⇒ 无 CORS、无预检、无端口发现（端口就是页面
 * 自己的）。而 connect 在派发时会**剥掉挂载前缀**（handler 里看到的是 "/status"），"到底路由到
 * 没有 / 前缀剥得对不对"只有真起一次才作数。独立进程 + 临时端口那套组合已实测不自洽
 * （跨源、轮询读不到体、自定义头触发预检），**不作备选**。
 *
 * ## 路径字面量在这里是**硬编码**的（故意的）
 *
 * `/__export/status|run|file` 三串逐字写死：契约测试若跟着实现里的常量走，改名就测不出来了。
 * 页面侧（`src/engine/Stage.tsx` 的 `EXPORT_ROUTES`）由 `App.test.tsx` 的 `toHaveBeenCalledWith`
 * 逐字钉住——两端各自钉死，任一侧改名即另一侧红。
 *
 * ## 环境（与既有两份"jsdom 里自起 Vite"的文件同款，K-85② 记着该抽共享 setup——本轮照抄第三份）
 *
 *   · vitest 的 setupFiles 全局是 jsdom；**不得**在文件任何位置写出 environment 标记字面量
 *     （vitest 全文扫描，含注释）；
 *   · Vite（连带 esbuild）在 jsdom 里要求本 realm 的 TextEncoder/Uint8Array：逐字照抄
 *     `scripts/render/realtime.browser.test.ts` 的补丁（三行 + 一个子类）；
 *   · 伪造 `Host` 只能用 `node:http`（实测：undici 的 fetch **不发**自定义 Host——规范里它是
 *     forbidden header，实测服务端收到的是真 host）。跨源那条用 `Origin` 头（fetch 可以设）。
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExportService, type ExportJob, type ExportService } from "./export-service";

// ── 环境补齐（必须在任何 createServer 之前；见文件头） ──

class RealmTextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    const src = super.encode(input);
    const out = new Uint8Array(src.length); // 长度重载 → 普通 ArrayBuffer 背板（本 realm）
    out.set(src);
    return out;
  }
}
(globalThis as { TextEncoder?: unknown }).TextEncoder = RealmTextEncoder;
(globalThis as { TextDecoder?: unknown }).TextDecoder = NodeTextDecoder;
(globalThis as { TransformStream?: unknown }).TransformStream ??= NodeTransformStream;

// ── 夹具 ──

/** 可手动收放的假作业：run() 挂起，直到测试给结果（状态机的每个态都要能停在原地断言）。 */
class FakeJob implements ExportJob {
  calls = 0;
  private pending: Array<{ resolve: (r: { file: string; code: number }) => void; reject: (e: unknown) => void }> = [];

  run(): Promise<{ file: string; code: number }> {
    this.calls += 1;
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  finish(result: { file: string; code: number }): void {
    const head = this.pending.shift();
    if (head === undefined) throw new Error("FakeJob.finish：没有挂起的 run()");
    head.resolve(result);
  }

  fail(e: unknown): void {
    const head = this.pending.shift();
    if (head === undefined) throw new Error("FakeJob.fail：没有挂起的 run()");
    head.reject(e);
  }
}

interface Harness {
  /** 本机基址（`http://127.0.0.1:<port>`，末尾无斜杠） */
  base: string;
  service: ExportService;
  job: FakeJob;
  close(): Promise<void>;
}

let harness: Harness | undefined;
const tmpDirs: string[] = [];

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `export-service-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

/** 真起一个 Vite（只挂本插件），拿到 resolvedUrls 里的回环基址。 */
async function startHarness(): Promise<Harness> {
  const job = new FakeJob();
  const service = createExportService({ job });
  const { createServer } = await import("vite");
  const root = tmpDir("root");
  const server = await createServer({
    root,
    configFile: false,
    plugins: [service.plugin],
    logLevel: "silent",
    server: { hmr: false },
  });
  await server.listen();
  const urls = server.resolvedUrls;
  if (urls === null || urls.local.length === 0) {
    throw new Error("Vite 已 listen 但 resolvedUrls 为空——拿不到可访问基址（拒绝把 undefined 传下去）");
  }
  return {
    base: urls.local[0].replace(/\/+$/, ""),
    service,
    job,
    close: async () => {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** 让服务端作业的 then/catch 落到（微任务只跑一轮不够：服务里套了一层 await）。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface StatusBody {
  state: string;
  progress: { done: number; total: number };
  message?: string;
}

async function getStatus(h: Harness): Promise<{ status: number; body: StatusBody }> {
  const res = await fetch(`${h.base}/__export/status`);
  return { status: res.status, body: (await res.json()) as StatusBody };
}

async function postRun(h: Harness, headers: Record<string, string> = {}): Promise<Response> {
  return await fetch(`${h.base}/__export/run`, { method: "POST", headers });
}

/** 用 node:http 发一条可自定义 Host 的请求（undici 的 fetch 做不到——见文件头）。 */
function rawRequest(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: "GET", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("导出服务 · 路由与状态机", () => {
  it("初始 idle（progress 0/0）", async () => {
    const { status, body } = await getStatus(harness!);
    expect(status).toBe(200);
    expect(body.state).toBe("idle");
    expect(body.progress).toEqual({ done: 0, total: 0 });
  });

  it("POST /run 触发一次；重复触发 → 409", async () => {
    const first = await postRun(harness!);
    expect(first.status).toBe(202);
    expect(harness!.job.calls).toBe(1);
    expect((await getStatus(harness!)).body.state).toBe("running");

    const second = await postRun(harness!);
    expect(second.status).toBe(409);
    expect(harness!.job.calls).toBe(1);
    expect((await second.json()) as { error: string }).toHaveProperty("error");
  });

  it("状态机：idle → running（带进度读数）→ done；done 后可再次导出", async () => {
    const file = path.join(tmpDir("out"), "presentation.mp4");
    fs.writeFileSync(file, Buffer.from("mp4-bytes"));

    await postRun(harness!);
    harness!.service.reportProgress(0, 3);
    harness!.service.reportProgress(2, 3);
    const running = await getStatus(harness!);
    expect(running.body.state).toBe("running");
    expect(running.body.progress).toEqual({ done: 2, total: 3 });

    harness!.job.finish({ file, code: 0 });
    await flush();
    const done = await getStatus(harness!);
    expect(done.body.state).toBe("done");
    expect(done.body.message).toContain("presentation.mp4");

    expect((await postRun(harness!)).status).toBe(202);
    expect(harness!.job.calls).toBe(2);
  });

  it("失败两条路都进 failed + message：抛错 / 退出码非 0", async () => {
    // 抛错
    await postRun(harness!);
    harness!.job.fail(new Error("帧流捕捉失败：worker 炸了"));
    await flush();
    const thrown = await getStatus(harness!);
    expect(thrown.body.state).toBe("failed");
    expect(thrown.body.message).toContain("帧流捕捉失败：worker 炸了");

    // 退出码非 0（runRender 的退出码 1 = 未通过自校验；仍可能留下未通过校验的 mp4）
    await postRun(harness!);
    harness!.job.finish({ file: path.join(tmpDir("out2"), "presentation.mp4"), code: 1 });
    await flush();
    const nonZero = await getStatus(harness!);
    expect(nonZero.body.state).toBe("failed");
    expect(nonZero.body.message).toContain("1");
  });

  it("未知子路径 → 404；方法不符（GET /run）→ 405", async () => {
    expect((await fetch(`${harness!.base}/__export/nope`)).status).toBe(404);
    expect((await fetch(`${harness!.base}/__export/run`)).status).toBe(405);
  });
});

describe("导出服务 · 同源闸门（Host / Origin）", () => {
  it("正常同源 → 200；伪造 Host（DNS rebinding 形状）→ 403", async () => {
    const ok = await getStatus(harness!);
    expect(ok.status).toBe(200);

    const forged = await rawRequest(`${harness!.base}/__export/status`, {
      host: "evil.example.com",
    });
    expect(forged.status).toBe(403);
    expect(forged.body).toContain("evil.example.com"); // 读数带拒绝理由（排障面）
    expect(forged.body).toContain("回环");
  });

  it("跨源 Origin（别的站点 fetch 过来）→ 403；同源 Origin（浏览器的 POST 形状）→ 202", async () => {
    const cross = await fetch(`${harness!.base}/__export/status`, {
      headers: { origin: "https://evil.example.com" },
    });
    expect(cross.status).toBe(403);

    const sameOrigin = await postRun(harness!, { origin: harness!.base });
    expect(sameOrigin.status).toBe(202);
  });

  it("回环别名都算同源：127.0.0.1 / localhost（Vite 默认 host=localhost，页面按 localhost 访问）", async () => {
    const port = new URL(harness!.base).port;
    const viaLocalhost = await fetch(`http://localhost:${port}/__export/status`);
    expect(viaLocalhost.status).toBe(200);
  });
});

describe("导出服务 · GET /file", () => {
  it("无产物 → 404", async () => {
    expect((await fetch(`${harness!.base}/__export/file`)).status).toBe(404);
    // running 中同样没有可取的产物（避免把上一轮的旧片当本次结果交出去）
    await postRun(harness!);
    expect((await fetch(`${harness!.base}/__export/file`)).status).toBe(404);
  });

  it("有产物 → 200 + Content-Disposition: attachment + 真实字节", async () => {
    const out = tmpDir("file");
    const file = path.join(out, "presentation.mp4");
    const payload = Buffer.from("fake-mp4-payload-0123456789");
    fs.writeFileSync(file, payload);

    await postRun(harness!);
    harness!.job.finish({ file, code: 0 });
    await flush();

    const res = await fetch(`${harness!.base}/__export/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="presentation.mp4"');
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe(String(payload.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(payload)).toBe(true);
  });

  it("失败后不再交出产物（上一次成功的片不得冒充本次结果）", async () => {
    const out = tmpDir("stale");
    const file = path.join(out, "presentation.mp4");
    fs.writeFileSync(file, Buffer.from("first-run"));

    await postRun(harness!);
    harness!.job.finish({ file, code: 0 });
    await flush();
    expect((await fetch(`${harness!.base}/__export/file`)).status).toBe(200);

    await postRun(harness!);
    harness!.job.fail(new Error("第二次炸了"));
    await flush();
    expect((await fetch(`${harness!.base}/__export/file`)).status).toBe(404);
  });

  // T5 修复轮 1（评审 I-1，真缺陷）：中文 slug（`scaffold.sh` 的用法文案就是 `--slug 项目名`）
  // ⇒ 产物名 `演示片.mp4`。`path.basename(file)` 直拼进 `Content-Disposition` 会让
  // **setHeader 抛 ERR_INVALID_CHAR**（node 的 header 值是 latin1 口径）⇒ `/file` 变成 **500 空体**，
  // 而 `/status` 照旧正常（只在取片那一下暴露）。
  it("非 ASCII 产物名：/file 200 + RFC 6266 双参数头（filename* 带原名）+ 真字节可取", async () => {
    const out = tmpDir("nonascii");
    const name = "演示片.mp4";
    const file = path.join(out, name);
    const payload = Buffer.from("non-ascii-name-payload");
    fs.writeFileSync(file, payload);

    await postRun(harness!);
    harness!.job.finish({ file, code: 0 });
    await flush();
    const status = await getStatus(harness!);
    expect(status.body.state).toBe("done");
    expect(status.body.message).toBe(name); // /status 侧一直正常（对照：故障只在取片那一下）

    const res = await fetch(`${harness!.base}/__export/file`);
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    // 形态：ASCII 回退名走 filename=，原名走 filename*=UTF-8''<percent-encoded>（RFC 5987）
    const m = /^attachment; filename="([\x20-\x7E]+)"; filename\*=UTF-8''(.+)$/.exec(disposition);
    expect(m, `Content-Disposition 形态不符：${disposition}`).not.toBeNull();
    expect(m![1]).toMatch(/\.mp4$/); // 回退名保住扩展名（客户端至少知道是什么文件）
    expect(decodeURIComponent(m![2])).toBe(name); // 现代浏览器取到的就是原名
    expect(Buffer.from(await res.arrayBuffer()).equals(payload)).toBe(true);
  });
});

describe("导出服务 · 形态", () => {
  it("只 dev 生效：插件 apply === \"serve\"（生产构建不挂）", () => {
    expect(createExportService({ job: new FakeJob() }).plugin.apply).toBe("serve");
  });
});
