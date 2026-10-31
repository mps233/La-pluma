import { agentError } from '../utils/apiHelper.js';

const CUSTOM_TOOLS = Object.freeze([
  {
    id: 'pixel-paint',
    name: '像素画填色',
    description: '按 24×24 点阵和色板序号自动填色。',
    taskNames: ['MiniGame@PixelPaint@Begin'],
    paramsKey: 'pixel_paint'
  },
  {
    id: 'auto-raise-potential',
    name: '自动提升潜能',
    description: '从干员列表自动提升带提示标记的干员潜能。',
    taskNames: ['MiniGame@AutoRaisePotential@Begin'],
    paramsKey: 'auto_raise_potential'
  },
  {
    id: 'material-synthesis',
    name: '缺口材料合成',
    description: '从缺少材料的弹窗进入加工站，递归合成下级材料。',
    taskNames: ['MiniGame@MaterialSynthesis@Begin']
  },
  {
    id: 'cursed-relic',
    name: '刷傀影维多利亚皇冠',
    description: '反复开始傀影肉鸽探索，刷到维多利亚王冠后停止。',
    taskNames: ['MiniGame@CursedRelic@Begin']
  },
  {
    id: 'event-shop-blacklist',
    name: '活动商店兑换',
    description: '自动购买活动商店商品，可配置不购买的商品名。',
    taskNames: ['SS@Store@Begin'],
    paramsKey: 'event_shop'
  }
]);

const CUSTOM_TOOL_MAP = new Map(CUSTOM_TOOLS.map(tool => [tool.id, tool]));

function invalidParams(toolId, reason, details = {}) {
  return agentError('AGENT_CUSTOM_TOOL_PARAMS_INVALID', `工具参数不合法: ${reason}`, {
    statusCode: 400,
    details: { toolId, reason, ...details },
    retryable: false
  });
}

function normalizePixelPaint(input = {}) {
  if (!Array.isArray(input.groups) || input.groups.length === 0) {
    throw invalidParams('pixel-paint', 'pixel_paint.groups 必须是非空数组');
  }

  const groups = input.groups.map((group, groupIndex) => {
    const color = Number(group?.color);
    if (!Number.isInteger(color) || color < 0 || color > 39) {
      throw invalidParams('pixel-paint', `第 ${groupIndex + 1} 组的 color 必须是 0-39 的整数`);
    }
    if (!Array.isArray(group?.points) || group.points.length === 0) {
      throw invalidParams('pixel-paint', `第 ${groupIndex + 1} 组的 points 必须是非空数组`);
    }
    const points = group.points.map(point => {
      if (!Array.isArray(point) || point.length !== 2) {
        throw invalidParams('pixel-paint', 'points 的每一项必须是 [x, y]');
      }
      const [x, y] = point.map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 23 || y < 0 || y > 23) {
        throw invalidParams('pixel-paint', 'points 坐标必须是 0-23 的整数');
      }
      return [x, y];
    });
    return { color, points };
  });

  const result = { groups };
  if (input.swipe !== undefined) result.swipe = Boolean(input.swipe);
  if (input.grid_delay !== undefined) {
    const delay = Number(input.grid_delay);
    if (!Number.isInteger(delay) || delay < 0 || delay > 1000) {
      throw invalidParams('pixel-paint', 'grid_delay 必须是 0-1000 的整数');
    }
    result.grid_delay = delay;
  }
  return result;
}

function normalizeBlacklist(input = {}) {
  const blacklist = input.blacklist === undefined ? [] : input.blacklist;
  if (!Array.isArray(blacklist) || blacklist.some(item => typeof item !== 'string')) {
    throw invalidParams('event-shop-blacklist', 'event_shop.blacklist 必须是字符串数组');
  }
  return {
    blacklist: [...new Set(blacklist.map(item => item.trim()).filter(Boolean))].slice(0, 100)
  };
}

export function listCustomTools() {
  return CUSTOM_TOOLS.map(tool => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    requiresParams: Boolean(tool.paramsKey),
    paramsKey: tool.paramsKey || null
  }));
}

export function buildCustomToolTaskConfig(toolId, input = {}) {
  const tool = CUSTOM_TOOL_MAP.get(String(toolId || '').trim());
  if (!tool) {
    throw agentError('AGENT_CUSTOM_TOOL_NOT_FOUND', `未找到自定义工具: ${toolId}`, {
      statusCode: 404,
      details: { toolId, allowed: [...CUSTOM_TOOL_MAP.keys()] },
      retryable: false
    });
  }

  const params = { task_names: [...tool.taskNames] };

  if (tool.id === 'pixel-paint') {
    params.pixel_paint = normalizePixelPaint(input);
  } else if (tool.id === 'auto-raise-potential') {
    params.auto_raise_potential = {
      use_normal_token: Boolean(input.use_normal_token)
    };
  } else if (tool.id === 'event-shop-blacklist') {
    params.event_shop = normalizeBlacklist(input);
  }

  return {
    name: tool.name,
    type: 'Custom',
    params
  };
}
