import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/base.css";
import "./theme/fonts.css";

// font-preview 模式短路：?font-preview=1 时渲染字体配对对比页（dev-only 验收工具，替换正常 Stage）
const params = new URLSearchParams(window.location.search);
if (params.has("font-preview")) {
  import("./FontPreview").then(({ FontPreview }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<FontPreview />);
  });
} else {
  // 正常 App 渲染
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
