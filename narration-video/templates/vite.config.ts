import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
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
