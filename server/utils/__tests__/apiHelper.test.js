/**
 * apiHelper 工具类测试
 * 运行: node --test server/utils/__tests__/apiHelper.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { successResponse, errorResponse, validateRequired, safeJsonParse } from '../apiHelper.js';

describe('apiHelper', () => {
  describe('successResponse', () => {
    it('应该返回成功响应格式', () => {
      const result = successResponse({ id: 1 }, '操作成功');
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, '操作成功');
      assert.deepStrictEqual(result.data, { id: 1 });
    });

    it('应该使用默认消息', () => {
      const result = successResponse({ id: 1 });
      
      assert.strictEqual(result.message, '操作成功');
    });
  });

  describe('errorResponse', () => {
    it('应该返回错误响应格式', () => {
      const error = new Error('测试错误');
      const result = errorResponse(error, '操作失败');
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, '操作失败');
      assert.strictEqual(result.error, '测试错误');
    });

    it('应该使用错误消息作为默认消息', () => {
      const error = new Error('测试错误');
      const result = errorResponse(error);
      
      assert.strictEqual(result.message, '测试错误');
    });
  });

  describe('validateRequired', () => {
    it('应该通过验证', () => {
      const data = { name: 'test', value: 123 };
      
      assert.doesNotThrow(() => {
        validateRequired(data, ['name', 'value']);
      });
    });

    it('应该抛出缺少参数错误', () => {
      const data = { name: 'test' };
      
      assert.throws(() => {
        validateRequired(data, ['name', 'value']);
      }, /缺少必需参数: value/);
    });

    it('应该抛出多个缺少参数错误', () => {
      const data = {};
      
      assert.throws(() => {
        validateRequired(data, ['name', 'value']);
      }, /缺少必需参数: name, value/);
    });
  });

  describe('safeJsonParse', () => {
    it('应该成功解析 JSON', () => {
      const result = safeJsonParse('{"key":"value"}');
      
      assert.deepStrictEqual(result, { key: 'value' });
    });

    it('应该返回默认值当解析失败', () => {
      const result = safeJsonParse('invalid json', { default: true });
      
      assert.deepStrictEqual(result, { default: true });
    });

    it('应该返回 null 当没有默认值', () => {
      const result = safeJsonParse('invalid json');
      
      assert.strictEqual(result, null);
    });
  });
});

console.log('✅ 所有测试通过！');
