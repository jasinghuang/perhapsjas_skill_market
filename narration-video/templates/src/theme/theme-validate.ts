// 主题校验器（§11.1 #10 的校验内核）：必填 token 全定义 + var() 引用 ⊆ 主题定义。
// M3a 门禁与本计划契约测试共用同一实现。

export const REQUIRED_TOKENS: string[] = [
  // 基础 · 色
  "--surface", "--surface-2", "--surface-3",
  "--text", "--text-2", "--text-mute", "--text-faint",
  "--accent-1", "--rule", "--shell",
  // 阴影
  "--shadow-card", "--shadow-card-sm", "--shadow-stage",
  // 字阶
  "--t-display-1", "--t-display-2", "--t-h1", "--t-h2", "--t-h3",
  "--t-body", "--t-label",
  // 间距
  "--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6",
  "--grid-gutter",
  // 动效
  "--dur-fast", "--dur-mid", "--dur-slow",
  "--ease-in", "--ease-out", "--ease-emph", "--stagger",
  // 语义
  "--card-bg", "--card-border", "--card-radius", "--r-card", "--r-pill", "--border-w",
  "--table-border", "--table-head-bg", "--table-head-text", "--table-zebra",
  "--rule-w", "--rule-style",
  "--badge-bg", "--badge-text",
  "--hero-num-font", "--hero-num-weight", "--hero-num-track",
  "--decor-family",
  "--caption-stroke", "--caption-text", "--caption-radius", "--caption-size",
  // 字体
  "--font-display-cn", "--font-display-en", "--font-body", "--font-mono",
  // 舞台
  "--stage-pad-x", "--stage-pad-y",
];

const VAR_RE = /var\(\s*(--[\w-]+)/g;
const DEFINED_RE = /(--[\w-]+)\s*:/g;

function definedTokens(css: string): Set<string> {
  const set = new Set<string>();
  for (const m of css.matchAll(DEFINED_RE)) set.add(m[1]);
  return set;
}

export function validateTheme(
  tokensCss: string,
  themeJson: unknown,
  referencedVars: string[] = [],
): { errors: string[] } {
  const errors: string[] = [];
  const defined = definedTokens(tokensCss);

  if (!themeJson || typeof themeJson !== "object" || !("name" in themeJson)) {
    errors.push("theme.json 缺少 name 字段");
  }

  for (const t of REQUIRED_TOKENS) {
    if (!defined.has(t)) errors.push(`缺少必填 token: ${t}`);
  }

  for (const ref of referencedVars) {
    if (!defined.has(ref)) errors.push(`var() 引用未在主题中定义: ${ref}`);
  }

  // 主题内部 var() 引用（如 --card-bg: var(--surface)）也必须闭合
  for (const m of tokensCss.matchAll(VAR_RE)) {
    const name = m[1];
    if (!defined.has(name) && name !== "var") errors.push(`主题内部未定义引用: ${name}`);
  }

  return { errors };
}
