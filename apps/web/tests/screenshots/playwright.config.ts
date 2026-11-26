import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4300)

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.pw.ts',
  outputDir: path.resolve(__dirname, '..', '..', 'test-results', 'screenshots'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  reporter: [['line']],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    deviceScaleFactor: 1,
    screenshot: 'off',
    trace: 'off',
  },
  webServer: {
    command: 'node static-server.ts',
    cwd: path.resolve(__dirname, '..', 'visual'),
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'web',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: 'mobile',
      // 440×956 是 iPhone 16 Pro Max 的全屏逻辑尺寸；这里沿用浏览器测试的
      // Chromium 移动端描述符，只改视口，避免 WebKit 与 Chromium 渲染差异。
      use: { ...devices['Pixel 5'], viewport: { width: 440, height: 956 }, deviceScaleFactor: 1 },
    },
  ],
})
