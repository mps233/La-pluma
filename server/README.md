# 服务端参考

`server/` 下的工具类与数据脚本速查。路由、服务和 Agent API 的约定见 `AGENTS.md` 与根目录 `README.md`。

## 工具类（`server/utils/`）

### apiHelper.js — API 辅助工具

统一的 API 响应格式和错误处理。

| 导出 | 用途 |
| --- | --- |
| `successResponse(data, message?, meta?)` | 服务层返回标准成功结构 |
| `errorResponse(error, message?, meta?)` | 服务层返回标准错误结构 |
| `agentError(code, message, options?)` | Agent API 的结构化错误：稳定 code、HTTP 状态、`retryable` |
| `sendSuccess(res, req, data, message?, meta?)` | 路由层直接发送成功响应，自动带上请求元信息 |
| `sendDryRun(res, req, plan, message?)` | 路由层发送 dry-run 结果 |
| `sendError(res, req, error, fallbackMessage?, meta?)` | 路由层发送错误响应 |
| `asyncHandler(fn)` | 包装路由处理器，自动捕获异步错误 |
| `validateRequired(data, fields)` | 校验必需字段，缺失时抛错 |
| `safeJsonParse(str, fallback?)` | 容错 JSON 解析 |

```javascript
import { successResponse, errorResponse, asyncHandler, validateRequired } from '../utils/apiHelper.js';

router.get('/api/data', asyncHandler(async (req, res) => {
  const data = await someAsyncOperation();
  res.json(successResponse(data, '获取成功'));
}));

router.post('/api/save', asyncHandler(async (req, res) => {
  validateRequired(req.body, ['name', 'value']); // 缺少参数会抛出错误
  res.json(successResponse(await saveData(req.body)));
}));
```

### fileHelper.js — 文件操作

```javascript
import { readJsonFile, writeJsonFile, updateJsonFile, deleteJsonFile, ensureDir } from '../utils/fileHelper.js';

// 读取 JSON 文件（文件不存在时返回默认值）
const config = await readJsonFile('./config.json', { default: 'value' });

// 写入 JSON 文件（自动创建目录）
await writeJsonFile('./data/output.json', { key: 'value' });

// 安全更新 JSON 文件（读取→修改→写入）
await updateJsonFile('./data/counter.json', (data) => {
  data.count = (data.count || 0) + 1;
  return data;
}, { count: 0 });

await deleteJsonFile('./data/obsolete.json');
await ensureDir('./data/logs');
```

### logger.js — 日志

```javascript
import { createLogger, loggerManager } from '../utils/logger.js';

const logger = createLogger('MyService');
logger.info('服务启动');
logger.debug('调试信息', { userId: 123 });
logger.warn('警告信息');
logger.error('错误信息', { error: err.message });
logger.success('操作成功');

const recentLogs = logger.getRecentLogs(50);
const errors = logger.filterByLevel('ERROR');
logger.clear();

loggerManager.getAllLogs();
loggerManager.clearAll();
```

### 约定

1. **统一响应格式**：所有 API 都使用 `successResponse` 和 `errorResponse`
2. **统一文件操作**：使用 `fileHelper` 处理所有 JSON 文件读写
3. **结构化日志**：使用 `createLogger` 替代 `console.log`
4. **错误处理**：使用 `asyncHandler` 包装路由处理器
5. **参数验证**：使用 `validateRequired` 验证必需参数

## 数据脚本（`server/scripts/`）

在 `server/` 目录下执行，输出写入 `server/data/`。

| 脚本 | npm 命令 | 输出 | 用途 |
| --- | --- | --- | --- |
| `check-syntax.js` | `npm run check` | — | 校验后端 JS 语法 |
| `run-tests.js` | `npm test` | — | 运行 Node 测试 |
| `fetch-operator-materials.js` | `npm run fetch-materials` | `data/operator-materials.json` | 干员精英化材料 |
| `fetch-material-formulas.js` + `merge-formulas.js` | `npm run fetch-formulas` | `data/material-formulas.json`、`data/materials.json` | 材料合成公式与合并 |
| `fetch-all-materials.js` | `npm run fetch-all-materials` | `data/materials.json` | 材料总表 |
| `fetch-stage-data.js` | `npm run fetch-stages` | `data/stages.json` | 关卡数据 |
| `fetch-paradox-operators.js` | `npm run fetch-paradox` | `data/paradox-operators.json` | 悖论模拟干员 |
| `fetch-game-assets.js` | `npm run fetch-assets` | `data/characters.json`、`skills.json`、`items.json` | 游戏静态资源 |
| — | `npm run fetch-game-data` | — | 依次执行 `fetch-stages` 和 `fetch-paradox` |

数据来自 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。游戏版本更新后运行对应脚本刷新 `server/data/`；这些脚本会联网并改写仓库内的数据文件，运行后应把生成结果当作数据变更单独审阅，不要夹带在无关改动里。

运行时的物品、配方、关卡、干员目录、悖论映射和活动数据已改为读取 MaaResource；其中 `operator-materials.json` 仍是干员精英化需求的来源。`stages.json` 和 `paradox-operators.json` 已不再参与运行时，保留为历史数据。`material-formulas.json`、`materials.json`、`characters.json`、`skills.json`、`items.json` 目前没有运行时消费者。

`data/operator-materials.json` 以干员 ID 为键，`elite1` / `elite2` 分别记录龙门币、材料与芯片需求。干员总数以文件里的 `metadata.totalOperators` 为准，不要在文档或代码里写死。
