import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4300)

/**
 * 视觉基线 harness 配置：只允许在与 @playwright/test 版本一致的官方 Playwright
 * 镜像内运行（经仓库根 `pnpm visual` 包装脚本进入），字体与浏览器构造为“本地 = CI”，
 * 基线截图为 Linux/Chromium 专属，换环境必须重新生成。
 */
export default defineConfig({
  testDir: __dirname,
  // .pw.ts 后缀：既与 vitest 的默认 include（*.test.* / *.spec.*）隔离，
  // 也避免 vitest 误把视觉测试当单测执行。
  testMatch: '**/*.pw.ts',
  outputDir: path.resolve(__dirname, '..', '..', 'test-results'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 1,
  reporter: [['line']],
  expect: {
    // 跨次渲染的字体反锯齿像素噪点无法用确定性环境消除，全局放行 2% 差异像素，
    // 避免把栅格抖动当回归重录基线。
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  timeout: 60_000,
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{projectName}-{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // 动效：模拟系统级"减弱动态效果"。MotionConfig reducedMotion="user"
    // 使 framer-motion 全部动画即时完成；CSS 动画/过渡由 spec 里的
    // 注入样式一并禁用（见 app.pw.ts）。
    reducedMotion: 'reduce',
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    deviceScaleFactor: 1,
    screenshot: 'off',
    trace: 'off',
  },
  webServer: {
    command: `node static-server.ts`,
    cwd: __dirname,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    // 中间断点：820 落在 sm（640）与 workbench（900）之间，与 desktop 一起把
    // workbench 具名断点两侧夹住；同时也是"无侧栏 + 顶栏标题"的组合，
    // 390 与 1440 都覆盖不到。
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
  ],
})
