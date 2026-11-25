# shadcn 生成物

本目录只存放 shadcn CLI 生成的 UI 原语，随上游原样保留。

- 来源：`pnpm dlx shadcn@latest add <name>`，生成结果与本仓库 `components.json` aliases（base-nova / Base UI）下的上游原文逐字一致；`cn` 直接来自官方 `cn` 包。
- 上游注释与 `use client` 指令（本项目无 RSC）随原文保留，不适用仓库零注释政策；任何有意本地修改必须是明确的语义决策并记录。
- 应用层通用组件位于 `src/shared/components/`，统一经其 `index.ts` 导出；不要向本目录添加手写组件。
- 本地语义修改：`sidebar.tsx` 用于固定桌面侧栏，已移除未使用的 provider 副作用（状态 cookie、键盘快捷键）、mobile Sheet 与折叠机制，只保留壳层实际使用的导出；`scroll-area.tsx` 移除未使用的 `React` 命名空间导入，满足 `noUnusedLocals`，无运行时语义变化；`slider.tsx` 增加本地 `thumbAriaLabel` prop，将无障碍名称转发到 Base UI thumb 内部 input，避免调用点依赖不可达的 `aria-label`。
