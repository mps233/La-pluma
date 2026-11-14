import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      'no-empty-pattern': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^[A-Z_]',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
    },
  },
  // shadcn CLI 生成物随上游原样入库（hook 与 variants 常量是官方 API 面的一部分），
  // fast refresh 检查不对生成物生效；自研组件仍在约束范围内。
  {
    files: ['src/shared/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // flat config 中同一规则后置块会整体覆盖前置块，因此每个块都写全该目录需要的 patterns。
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^@/features/[^/]+/.+',
          message: '功能域对外只有 index.ts 一个公开面，请改为 @/features/<domain> 根 import。',
        }],
      }],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^@/features/[^/]+/.+',
            message: '功能域对外只有 index.ts 一个公开面，请改为 @/features/<domain> 根 import。',
          },
          {
            regex: '^@/app(?:/.*)?$',
            message: 'app 是组装层，features/shared 不得反向依赖 @/app。',
          },
          {
            regex: '^@/pages(?:/.*)?$',
            message: 'pages 是组合层，features/shared 不得反向依赖 @/pages。',
          },
        ],
      }],
    },
  },
  {
    // `^@/features(?:/.*)?$` 已同时覆盖根 import 与深路径，重复列深路径 pattern 会让同一处 import 报两条错误。
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^@/features(?:/.*)?$',
            message: 'shared 不感知 features，请把跨域能力留在所属域内或上移到 shared 的通用能力。',
          },
          {
            regex: '^@/app(?:/.*)?$',
            message: 'app 是组装层，features/shared 不得反向依赖 @/app。',
          },
          {
            regex: '^@/pages(?:/.*)?$',
            message: 'shared 不感知 pages，组合职责留在 pages/app。',
          },
        ],
      }],
    },
  },
  {
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^@/features/[^/]+/.+',
            message: '页面只能经功能域根入口组合，请改为 @/features/<domain> 根 import。',
          },
          {
            regex: '^@/app(?:/.*)?$',
            message: 'pages 是组合层，不得反向依赖 @/app。',
          },
        ],
      }],
    },
  },
  {
    // 页面测试允许深路径到被测域内部（构造领域状态），不进入产物；
    // 分层方向仍然生效，只是放开 @/features/<domain>/... 的深路径。
    files: ['src/pages/**/*.{test,spec}.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^@/app(?:/.*)?$',
            message: 'pages 是组合层，不得反向依赖 @/app。',
          },
        ],
      }],
    },
  },
])
