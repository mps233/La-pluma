# 工具类使用文档

本目录包含项目中常用的工具类，用于减少代码重复，提高代码质量。

## 📁 文件列表

### 1. apiHelper.js - API 辅助工具

统一的 API 响应格式和错误处理。

**使用示例**：

```javascript
import { successResponse, errorResponse, asyncHandler, validateRequired } from '../utils/apiHelper.js';

// 在路由中使用 asyncHandler 自动捕获错误
router.get('/api/data', asyncHandler(async (req, res) => {
  const data = await someAsyncOperation();
  res.json(successResponse(data, '获取成功'));
}));

// 验证必需参数
router.post('/api/save', asyncHandler(async (req, res) => {
  validateRequired(req.body, ['name', 'value']); // 缺少参数会抛出错误
  
  const result = await saveData(req.body);
  res.json(successResponse(result));
}));

// 在服务层返回统一格式
export async function getData() {
  try {
    const data = await fetchData();
    return successResponse(data);
  } catch (error) {
    return errorResponse(error, '获取数据失败');
  }
}
```

### 2. fileHelper.js - 文件操作工具

统一的文件读写操作，特别是 JSON 文件。

**使用示例**：

```javascript
import { readJsonFile, writeJsonFile, updateJsonFile, ensureDir } from '../utils/fileHelper.js';

// 读取 JSON 文件（文件不存在时返回默认值）
const config = await readJsonFile('./config.json', { default: 'value' });

// 写入 JSON 文件（自动创建目录）
await writeJsonFile('./data/output.json', { key: 'value' });

// 安全更新 JSON 文件（读取→修改→写入）
await updateJsonFile('./data/counter.json', (data) => {
  data.count = (data.count || 0) + 1;
  return data;
}, { count: 0 });

// 确保目录存在
await ensureDir('./data/logs');
```

### 3. logger.js - 日志服务

结构化的日志记录和管理。

**使用示例**：

```javascript
import { createLogger } from '../utils/logger.js';

// 创建服务专用的 Logger
const logger = createLogger('MyService');

// 记录不同级别的日志
logger.info('服务启动');
logger.debug('调试信息', { userId: 123 });
logger.warn('警告信息');
logger.error('错误信息', { error: err.message });
logger.success('操作成功');

// 获取最近的日志
const recentLogs = logger.getRecentLogs(50);

// 按级别过滤
const errors = logger.filterByLevel('ERROR');

// 清空日志
logger.clear();
```

**全局日志管理**：

```javascript
import { loggerManager } from '../utils/logger.js';

// 获取所有 Logger 的日志
const allLogs = loggerManager.getAllLogs();

// 清空所有日志
loggerManager.clearAll();
```

## 🎯 使用建议

### 后端服务重构

**重构前**：
```javascript
// ❌ 每个服务都重复写
try {
  const content = await fs.readFile(path, 'utf-8');
  const data = JSON.parse(content);
  return { success: true, data };
} catch (error) {
  return { success: false, error: error.message };
}
```

**重构后**：
```javascript
// ✅ 使用工具类
import { readJsonFile } from '../utils/fileHelper.js';
import { successResponse, errorResponse } from '../utils/apiHelper.js';

try {
  const data = await readJsonFile(path);
  return successResponse(data);
} catch (error) {
  return errorResponse(error);
}
```

### 日志记录重构

**重构前**：
```javascript
// ❌ 直接使用 console.log
console.log('[Service] 操作成功');
console.error('[Service] 错误:', error);
```

**重构后**：
```javascript
// ✅ 使用结构化日志
const logger = createLogger('Service');
logger.success('操作成功');
logger.error('错误', { error: error.message });
```

## 📝 最佳实践

1. **统一响应格式**：所有 API 都使用 `successResponse` 和 `errorResponse`
2. **统一文件操作**：使用 `fileHelper` 处理所有 JSON 文件读写
3. **结构化日志**：使用 `Logger` 替代 `console.log`
4. **错误处理**：使用 `asyncHandler` 包装路由处理器
5. **参数验证**：使用 `validateRequired` 验证必需参数

## 🔄 迁移指南

### 步骤 1：导入工具类

```javascript
import { successResponse, errorResponse } from '../utils/apiHelper.js';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.js';
import { createLogger } from '../utils/logger.js';
```

### 步骤 2：替换现有代码

- 将 `fs.readFile` + `JSON.parse` 替换为 `readJsonFile`
- 将 `fs.writeFile` + `JSON.stringify` 替换为 `writeJsonFile`
- 将 `{ success: true, data }` 替换为 `successResponse(data)`
- 将 `console.log` 替换为 `logger.info`

### 步骤 3：测试

确保重构后的代码功能正常，响应格式一致。

## 📊 重构进度

- ✅ `configStorageService.js` - 已重构
- ✅ `dropRecordService.js` - 已重构
- ✅ `dataParserService.js` - 已重构
- ✅ `operatorTrainingService.js` - 已重构
- ⏳ `notificationService.js` - 待重构（日志优化）
- ⏳ `schedulerService.js` - 待重构（日志优化）
- ⏳ `maaService.js` - 待重构（日志部分，低优先级）

## 🎉 预期收益

- **代码量减少** 30-40%
- **维护性提升** - 修改一处，全局生效
- **一致性提升** - 统一的错误处理和响应格式
- **可测试性提升** - 工具函数更容易单元测试
