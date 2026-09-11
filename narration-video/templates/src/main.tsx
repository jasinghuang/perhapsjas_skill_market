import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/base.css";
import "./theme/fonts.css";

// dev-only 验收工具短路（替换正常 Stage，与 App 渲染并列）：
// - ?showcase=1：主题效果页（44 组件全展示——组件数见 components/manifest.ts，M2b 验收）
// - ?font-preview=1：字体配对对比页（M2b 用户拍板）
// - ?styleguide=1：样式词典页（全部 token 视觉表达 + 44 组件全变体目录——见 components/manifest.ts，M2b 验收）
const params = new URLSearchParams(window.location.search);
if (params.has("showcase")) {
  import("./ThemeShowcase").then(({ ThemeShowcase }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<ThemeShowcase />);
  });
} else if (params.has("font-preview")) {
  import("./FontPreview").then(({ FontPreview }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<FontPreview />);
  });
} else if (params.has("styleguide")) {
  import("./StyleGuide").then(({ StyleGuide }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<StyleGuide />);
  });
} else {
  // 正常 App 渲染
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
