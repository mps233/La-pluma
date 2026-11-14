# 应用层通用组件

本目录是手写的通用 UI 组件，统一通过 `index.ts` 导出，页面中统一从 `@/shared/components` 引入。

- 设计规范（颜色、文字层级、间距、圆角、交互与反馈）：[DESIGN.md](../../../../DESIGN.md)，项目内唯一来源。
- 组件 API、用法与组件接入约定：[docs/frontend/components.md](../../../../docs/frontend/components.md)。

## 目录约定

- 每个组件一个文件，测试与实现放在同一目录（`*.test.tsx`）。
- 新增或调整组件时，同步更新 `index.ts` 与组件库文档；不要在页面里复制同一套 DOM 和样式。
- shadcn 生成物（button、sheet、sidebar 等上游原语）位于 `src/shared/ui/`，随上游原样保留；本目录组件可以组合它们，但生成物目录不承载手写组件。
- 设计规则只在根目录 `DESIGN.md` 维护，本目录的说明和代码注释不要另写一份。
