import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { getOperatorList, getAllOperators, getOperBoxData, getTrainingQueue, addToTrainingQueue, removeFromTrainingQueue, updateTrainingSettings, generateTrainingPlan, applyTrainingPlan, getItemIconUrl } from '../services/api'
import { PageHeader, Button, Checkbox, IconButton } from './common'
import { useStatusStore } from '../store/statusStore'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useFluidTabIndicator } from '../hooks/useFluidTabIndicator'
import type {
  MaterialHierarchyNodeProps,
  TrainingOperator,
  TrainingQueueItem,
  TrainingSettings,
  TrainingPlan,
  MaterialNode,
  TrainingFilters,
  TrainingPlanMode,
  TrainingOpenMenu
} from '@/types/components'

// 材料层级节点组件
function MaterialHierarchyNode({ node, depth = 0 }: MaterialHierarchyNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  
  const getColorByDepth = (_d: number): string => 'bg-[var(--app-accent)] text-white';
  
  const getBgColorByDepth = (): string => 'surface-soft border-[var(--app-border)]';
  
  // 只有顶层材料才返回完整的卡片结构
  if (depth === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="p-4 rounded-2xl surface-soft hover:shadow-xl transition-all space-y-3"
      >
        {/* 顶层材料 */}
        <div className={`p-3 rounded-xl border ${getBgColorByDepth()}`}>
          <div className="flex items-center gap-3">
            {/* 材料图标 */}
            <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
              {node.iconId ? (
                <img
                  src={getItemIconUrl(node.iconId)}
                  alt={node.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 图标加载失败时，隐藏图片并显示默认图标
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.default-icon')) {
                      const iconDiv = document.createElement('div');
                      iconDiv.className = `default-icon w-10 h-10 rounded-lg ${getColorByDepth(depth)} flex items-center justify-center`;
                      iconDiv.innerHTML = hasChildren 
                        ? '<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>'
                        : '<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                      parent.appendChild(iconDiv);
                    }
                  }}
                />
              ) : (
                <div className={`w-10 h-10 rounded-lg ${getColorByDepth(depth)} flex items-center justify-center`}>
                  {hasChildren ? (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-bold text-gray-900 dark:text-white text-sm">
                  {node.name}
                </span>
                {hasChildren && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium brand-chip">
                    需合成
                  </span>
                )}
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs">
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">拥有 </span>
                    <span className="font-bold text-green-600 dark:text-green-400">{node.have}</span>
                  </div>
                  <span className="text-gray-400">/</span>
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">需要 </span>
                    <span className="font-bold text-gray-700 dark:text-gray-300">{node.needed}</span>
                  </div>
                </div>
                
                {node.stillNeeded > 0 ? (
                  <div className="px-3 py-1 rounded-lg text-center brand-action">
                    <div className="text-xs font-bold">{hasChildren ? '还需合成' : '还需刷'} {node.stillNeeded}</div>
                  </div>
                ) : (
                  <div className="px-3 py-1 rounded-lg status-success text-center">
                    <div className="text-xs font-bold">✓ 已集齐</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* 子材料 */}
        {hasChildren && node.children && (
          <div className="space-y-2 pl-4 border-l-2 border-gray-200 dark:border-gray-700">
            {node.children.map((child, index) => (
              <MaterialHierarchyNode key={`${child.id}-${index}`} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </motion.div>
    );
  }
  
  // 子材料的简化显示
  return (
    <div className={`p-2.5 rounded-lg border ${getBgColorByDepth()}`}>
      <div className="flex items-center gap-2">
        {/* 材料图标 */}
        <div className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
          {node.iconId ? (
            <img
              src={getItemIconUrl(node.iconId)}
              alt={node.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                // 图标加载失败，显示默认图标
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.fallback-icon')) {
                  const fallbackDiv = document.createElement('div');
                  fallbackDiv.className = `fallback-icon w-7 h-7 rounded-lg ${getColorByDepth(depth)} flex items-center justify-center`;
                  fallbackDiv.innerHTML = hasChildren 
                    ? '<svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>'
                    : '<svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                  parent.appendChild(fallbackDiv);
                }
              }}
            />
          ) : (
            <div className={`w-7 h-7 rounded-lg ${getColorByDepth(depth)} flex items-center justify-center`}>
              {hasChildren ? (
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              )}
            </div>
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-gray-900 dark:text-white text-xs truncate">
              {node.name}
            </span>
            {node.stillNeeded > 0 ? (
              <span className="px-2 py-0.5 rounded font-bold text-xs brand-action">
                -{node.stillNeeded}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded status-success font-bold text-xs">✓</span>
            )}
          </div>
          
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-green-600 dark:text-green-400">{node.have}</span> / {node.needed}
            </span>
          </div>
        </div>
      </div>
      
      {/* 递归子材料 */}
      {hasChildren && node.children && (
        <div className="mt-2 space-y-1.5 pl-3 border-l border-gray-300 dark:border-gray-600">
          {node.children.map((child, index) => (
            <MaterialHierarchyNode key={`${child.id}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface MaterialGapListProps {
  materials?: MaterialNode[]
  limit?: number
  emptyText?: string
}

function MaterialGapList({
  materials = [],
  limit = 8,
  emptyText = '当前没有材料缺口'
}: MaterialGapListProps) {
  const missingMaterials = materials
    .filter(material => material.stillNeeded > 0)
    .sort((a, b) => b.stillNeeded - a.stillNeeded);
  const visibleMaterials = missingMaterials.slice(0, limit);
  const hiddenCount = Math.max(missingMaterials.length - visibleMaterials.length, 0);

  if (visibleMaterials.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200/80 bg-slate-50/70 px-4 py-5 text-sm text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400 dark:shadow-none">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {visibleMaterials.map((material) => (
        <div
          key={material.id}
          className="flex min-h-[60px] items-center gap-3 rounded-xl border border-slate-200/80 bg-white/85 px-3 py-2 shadow-[0_8px_22px_rgba(15,23,42,0.035),inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none"
        >
          <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 text-slate-400 ring-1 ring-slate-200/70 dark:from-slate-800 dark:to-slate-900 dark:text-slate-500 dark:ring-white/10">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            {material.iconId && (
              <img
                src={getItemIconUrl(material.iconId)}
                alt={material.name}
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{material.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{material.have}/{material.needed}</span>
              <span className="rounded-full bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">缺 {material.stillNeeded}</span>
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="flex min-h-[60px] items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-sm font-medium text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400 dark:shadow-none">
          还有 {hiddenCount} 种材料
        </div>
      )}
    </div>
  );
}

interface OperatorEmptyStateProps {
  title: string
  description: string
}

function OperatorEmptyState({ title, description }: OperatorEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/70 px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200/70 dark:bg-white/[0.06] dark:text-slate-500 dark:ring-white/10">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2m-9 4h10M5 7h14a1 1 0 011 1v11a2 2 0 01-2 2H6a2 2 0 01-2-2V8a1 1 0 011-1z" />
        </svg>
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

type FallbackOperatorRow = Partial<TrainingOperator> & {
  elite?: number
  level?: number
  potential?: number
  position?: string
}

type TrainingStatusCounts = Record<TrainingFilters['status'], number>
const OPERATOR_RENDER_BATCH_SIZE = 72

export default function OperatorTraining() {
  const shouldReduceMotion = useReducedMotion();
  const { setMessage: setStatusMessage } = useStatusStore()

  // 辅助函数：使用 statusMessage 显示消息
  const showSuccess = async (msg: string) => {
    setStatusMessage(msg)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setStatusMessage('')
  }
  const showError = async (msg: string) => {
    setStatusMessage(msg)
    await new Promise(resolve => setTimeout(resolve, 2000))
    setStatusMessage('')
  }
  const showInfo = (msg: string) => {
    setStatusMessage(msg)
  }
  
  const [operators, setOperators] = useState<TrainingOperator[]>([]);
  const [queue, setQueue] = useState<TrainingQueueItem[]>([]);
  const [settings, setSettings] = useState<TrainingSettings>({
    useMedicine: 0,
    useStone: 0,
    autoSwitch: true,
    notifyOnComplete: true
  });
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [operatorsLoading, setOperatorsLoading] = useState(false);
  const [statusCountsLoading, setStatusCountsLoading] = useState(false);
  const [trainingStatusCounts, setTrainingStatusCounts] = useState<TrainingStatusCounts>({
    trainable: 0,
    owned: 0,
    all: 0
  });
  const [filters, setFilters] = useState<TrainingFilters>({
    rarity: '',
    status: 'trainable',
    needsElite2: true
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [planMode, setPlanMode] = useState<TrainingPlanMode>('current');
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [visibleOperatorLimit, setVisibleOperatorLimit] = useState(OPERATOR_RENDER_BATCH_SIZE);
  const [openMenu, setOpenMenu] = useState<TrainingOpenMenu>(null);
  const { containerRef: statusTabsRef, activeRect: activeStatusTabRect, setTabRef: setStatusTabRef } = useFluidTabIndicator(filters.status);

  const getOpenStagePlan = (sourcePlan: TrainingPlan): TrainingPlan => ({
    ...sourcePlan,
    stages: sourcePlan.openStages ?? sourcePlan.stages?.filter(stage => stage.isOpen !== false) ?? []
  });

  const getOpenStageCount = (sourcePlan: TrainingPlan | null): number => {
    if (!sourcePlan) return 0;
    return sourcePlan.openStages?.length ?? sourcePlan.stages?.filter(stage => stage.isOpen !== false).length ?? 0;
  };

  const extractOperatorRows = (payload: unknown): FallbackOperatorRow[] => {
    const data = payload as { operators?: FallbackOperatorRow[]; data?: FallbackOperatorRow[] } | FallbackOperatorRow[] | null | undefined;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.operators)) return data.operators;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };

  const countOperatorsByCurrentMetaFilters = (rows: FallbackOperatorRow[], options: { rarity?: number; needsElite2?: boolean } = {}) =>
    rows.filter(operator => {
      if (options.rarity && operator.rarity !== options.rarity) return false;
      if (options.needsElite2) {
        const elite = operator.currentElite ?? operator.elite ?? 0;
        if (elite >= 2) return false;
      }
      return true;
    }).length;

  const loadTrainingStatusCounts = async () => {
    setStatusCountsLoading(true);
    try {
      const rarity = filters.rarity ? parseInt(filters.rarity) : undefined;
      const [trainableResponse, ownedResponse, allOperatorsResponse, operBoxResponse] = await Promise.all([
        getOperatorList({ status: 'trainable', rarity, needsElite2: filters.needsElite2 }),
        getOperatorList({ status: 'owned', rarity, needsElite2: filters.needsElite2 }),
        getAllOperators(),
        getOperBoxData()
      ]);

      const trainableRows = trainableResponse.success ? extractOperatorRows(trainableResponse.data) : [];
      const ownedRows = ownedResponse.success ? extractOperatorRows(ownedResponse.data) : [];
      const allRows = allOperatorsResponse.success ? extractOperatorRows(allOperatorsResponse.data) : [];
      const operBoxRows = operBoxResponse.success ? extractOperatorRows(operBoxResponse.data) : [];

      setTrainingStatusCounts(prev => {
        const ownedCount = ownedRows.length > 0
          ? ownedRows.length
          : countOperatorsByCurrentMetaFilters(operBoxRows, { rarity, needsElite2: filters.needsElite2 });
        const allCount = countOperatorsByCurrentMetaFilters(allRows, { rarity });

        return {
          trainable: trainableRows.length,
          owned: ownedCount,
          all: allCount > 0 ? allCount : prev.all
        };
      });
    } catch (error) {
      // 静默失败，保留上一次统计
    } finally {
      setStatusCountsLoading(false);
    }
  };

  // 加载干员列表
  useEffect(() => {
    loadOperators();
  }, [filters]);

  useEffect(() => {
    void loadTrainingStatusCounts();
  }, [filters.rarity, filters.needsElite2]);

  useEffect(() => {
    setVisibleOperatorLimit(OPERATOR_RENDER_BATCH_SIZE);
  }, [filters.status, filters.rarity, filters.needsElite2, searchTerm]);

  // 加载养成队列
  useEffect(() => {
    loadQueue();
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isInsideMenu = target.closest('.filter-menu-container');
      if (!isInsideMenu) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openMenu]);

  const loadOperators = async () => {
    try {
      setOperatorsLoading(true);
      const response = await getOperatorList({
        ...filters,
        rarity: filters.rarity ? parseInt(filters.rarity) : undefined
      });
      if (response.success) {
        // 适配新的响应格式：data.operators 是数组
        let nextOperators: TrainingOperator[] = response.data.operators || response.data || [];

        if (filters.status === 'all' && nextOperators.length === 0) {
          const [allOperatorsResponse, operBoxResponse] = await Promise.all([
            getAllOperators(),
            getOperBoxData()
          ]);

          if (allOperatorsResponse.success) {
            const allOperators: FallbackOperatorRow[] = allOperatorsResponse.data.operators || allOperatorsResponse.data || [];
            const operBoxPayload = operBoxResponse.success ? operBoxResponse.data : null;
            const ownedOperators: FallbackOperatorRow[] = operBoxPayload?.data || operBoxPayload?.operators || [];
            const ownedMap = new Map(ownedOperators.map(operator => [operator.id, operator]));
            const rarityFilter = filters.rarity ? parseInt(filters.rarity) : null;

            nextOperators = allOperators
              .filter(operator => !rarityFilter || operator.rarity === rarityFilter)
              .map((operator) => {
                const ownedOperator = ownedMap.get(operator.id);
                const owned = Boolean(ownedOperator);
                const disabledReason = owned ? 'missing_material_data' : 'unowned';

                return {
                  id: operator.id || '',
                  name: ownedOperator?.name || operator.name || '未知干员',
                  rarity: ownedOperator?.rarity ?? operator.rarity ?? 0,
                  profession: operator.profession || ownedOperator?.profession || '未知',
                  currentElite: owned ? (ownedOperator?.elite || 0) : 0,
                  currentLevel: owned ? (ownedOperator?.level || 1) : 0,
                  targetElite: 2,
                  owned,
                  potential: owned ? (ownedOperator?.potential || 1) : 0,
                  hasMaterialData: false,
                  canTrain: false,
                  disabledReason,
                  trainingStatus: disabledReason
                };
              });
          }
        }

        setOperators(nextOperators);
      }
    } catch (error) {
      // 静默失败，不影响用户体验
    } finally {
      setOperatorsLoading(false);
    }
  };

  const loadQueue = async () => {
    try {
      const response = await getTrainingQueue();
      if (response.success) {
        setQueue(response.data.queue);
        setSettings(response.data.settings);
        return response.data;
      }
    } catch (error) {
      // 静默失败
    }
    return null;
  };

  const handleAddToQueue = async (operator: TrainingOperator) => {
    try {
      setLoading(true);
      setStatusMessage('正在添加干员...');
      
      const response = await addToTrainingQueue({
        operatorId: operator.id,
        currentElite: operator.currentElite ?? 0,
        targetElite: operator.targetElite ?? 2
      });

      if (response.success) {
        const queueData = await loadQueue();
        setPlan(null);
        setStatusMessage(`${operator.name} 添加成功！`);
        await new Promise(resolve => setTimeout(resolve, 800));

        const addedIsCurrent = queueData?.queue?.[0]?.operatorId === operator.id;
        if (!addedIsCurrent) {
          setStatusMessage(`${operator.name} 已加入队列，将在当前目标完成后处理`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          setStatusMessage('');
          return;
        }

        setStatusMessage('正在生成刷取计划...');

        // 首个队列目标可以直接生成并加入今日流程。
        try {
          const planResponse = await generateTrainingPlan({ mode: 'current' });
          if (planResponse.success && planResponse.data) {
            const generatedPlan = planResponse.data;
            setPlan(generatedPlan);

            const todayPlan = getOpenStagePlan(generatedPlan);
            if (!todayPlan.stages || todayPlan.stages.length === 0) {
              setStatusMessage('今天没有可直接加入流程的开放关卡');
              await new Promise(resolve => setTimeout(resolve, 2000));
              setStatusMessage('');
              return;
            }

            setStatusMessage('正在应用到作战任务...');

            // 自动应用到作战任务
            try {
              const applyResponse = await applyTrainingPlan({
                plan: todayPlan,
                settings: queueData?.settings ?? settings
              });
              if (applyResponse.success) {
                window.dispatchEvent(new CustomEvent('training-plan-applied', {
                  detail: { stageCount: applyResponse.data?.stageCount ?? todayPlan.stages.length }
                }));
                setStatusMessage('刷取计划已应用到作战任务！');
                await new Promise(resolve => setTimeout(resolve, 1500));
                setStatusMessage('');
              } else {
                setStatusMessage('应用失败');
                await new Promise(resolve => setTimeout(resolve, 2000));
                setStatusMessage('');
              }
            } catch (applyError) {
              setStatusMessage('应用失败');
              await new Promise(resolve => setTimeout(resolve, 2000));
              setStatusMessage('');
            }
          } else {
            setStatusMessage('生成计划失败');
            await new Promise(resolve => setTimeout(resolve, 2000));
            setStatusMessage('');
          }
        } catch (planError) {
          setStatusMessage('生成计划失败');
          await new Promise(resolve => setTimeout(resolve, 2000));
          setStatusMessage('');
        }
      }
    } catch (error: any) {
      setStatusMessage('添加失败');
      await new Promise(resolve => setTimeout(resolve, 2000));
      setStatusMessage('');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromQueue = async (operatorId: string) => {
    try {
      setLoading(true);
      setStatusMessage('正在删除...');
      const response = await removeFromTrainingQueue(operatorId);
      if (response.success) {
        await loadQueue();
        setPlan(null);
        setStatusMessage('删除成功！');
        await new Promise(resolve => setTimeout(resolve, 1500));
        setStatusMessage('');
      }
    } catch (error) {
      setStatusMessage('删除失败');
      await new Promise(resolve => setTimeout(resolve, 2000));
      setStatusMessage('');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (queue.length === 0) {
      showError('养成队列为空，请先添加干员');
      return;
    }
    
    try {
      setLoading(true);
      showInfo('生成中...');
      const response = await generateTrainingPlan({ mode: planMode });
      if (response.success) {
        setPlan(response.data);
        showSuccess('刷取计划生成成功！');
      }
    } catch (error: any) {
      showError(error.response?.data?.error || '生成计划失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPlan = async () => {
    if (!plan) return;
    const todayPlan = getOpenStagePlan(plan);
    if (!todayPlan.stages || todayPlan.stages.length === 0) {
      showError('今天没有可加入流程的开放关卡');
      return;
    }
    
    try {
      setLoading(true);
      showInfo('应用中...');
      const response = await applyTrainingPlan({
        plan: todayPlan,
        settings
      });
      
      if (response.success) {
        showSuccess('养成计划已应用到作战任务流程！');
        
        // 触发事件通知其他组件重新加载配置
        window.dispatchEvent(new CustomEvent('training-plan-applied', {
          detail: { stageCount: response.data?.stageCount ?? todayPlan.stages.length }
        }));
      }
    } catch (error: any) {
      showError(error.response?.data?.error || '应用失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async (newSettings: TrainingSettings) => {
    try {
      const response = await updateTrainingSettings(newSettings);
      if (response.success) {
        setSettings(response.data);
      }
    } catch (error) {
      // 静默失败
    }
  };

  // 过滤干员
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredOperators = operators.filter(op => {
    if (normalizedSearchTerm && !op.name.toLowerCase().includes(normalizedSearchTerm)) {
      return false;
    }
    return true;
  });
  const visibleOperators = filteredOperators.slice(0, visibleOperatorLimit);
  const hiddenOperatorCount = Math.max(filteredOperators.length - visibleOperators.length, 0);
  const openStageCount = getOpenStageCount(plan);
  const currentTarget = queue[0] ?? null;
  const backlogCount = Math.max(queue.length - 1, 0);
  const todayStages = plan ? getOpenStagePlan(plan).stages ?? [] : [];
  const todayRunCount = todayStages.reduce((sum, stage) => sum + Number(stage.totalTimes ?? 0), 0);
  const currentMissingMaterials = currentTarget?.materials?.filter(material => material.stillNeeded > 0) ?? [];
  const currentMissingPreview = currentMissingMaterials.slice(0, 3).map(material => material.name).join('、');
  const currentProgress = currentTarget?.progress ?? 0;
  const planFocusName = plan?.focusOperator?.name || plan?.operators?.[0]?.name || currentTarget?.operator.name || '未设置';
  const upcomingQueue = currentTarget ? queue.slice(1) : queue;
  const previewStages = todayStages.slice(0, 5);
  const hiddenStageCount = Math.max(todayStages.length - previewStages.length, 0);
  const operatorEmptyState: OperatorEmptyStateProps | null = !operatorsLoading && filteredOperators.length === 0
    ? (() => {
        if (normalizedSearchTerm || filters.rarity) {
          return {
            title: '没有找到符合条件的干员',
            description: '换个名称、稀有度或状态筛选再试。'
          };
        }

        if (filters.status === 'trainable') {
          return {
            title: '没有可养成干员',
            description: '当前没有可直接加入队列的干员，可以切到“已拥有”或“全部”查看其他状态。'
          };
        }

        if (filters.status === 'owned') {
          return {
            title: '还没有已拥有干员',
            description: '请先在“数据统计”页面识别干员，或切到“全部”查看完整干员列表。'
          };
        }

        return {
          title: '没有干员数据',
          description: '全量干员数据暂不可用，请先更新资源或稍后重试。'
        };
      })()
    : null;
  const trainingStatusOptions: Array<{ value: TrainingFilters['status']; label: string; desc: string }> = [
    { value: 'trainable', label: '可养成', desc: '可加入队列' },
    { value: 'owned', label: '已拥有', desc: '已识别干员' },
    { value: 'all', label: '全部', desc: '含未拥有' }
  ];
  const activeTrainingStatusOption = trainingStatusOptions.find(option => option.value === filters.status) ?? trainingStatusOptions[0];

  return (
    <div className="app-page">
      <div className="max-w-7xl mx-auto app-stack-section">
        {/* 页面标题 */}
        <PageHeader
          icon={
            <svg className="w-6 h-6 brand-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          }
          title="智能养成系统"
          subtitle="自动识别未精二干员，计算材料需求，生成刷取计划"
          actions={<FloatingStatusIndicator />}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_430px] gap-6 items-start">
          <section className={`space-y-4 ${currentTarget ? 'order-2 xl:order-1' : 'order-1'}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white">添加干员</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">筛选并加入养成队列</p>
              </div>
              <div className="rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400">
                队列 {queue.length} · 今日计划 {openStageCount} 个关卡
              </div>
            </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* 搜索和过滤 */}
          <div className="flex flex-col gap-3">
            <div
              ref={statusTabsRef}
              className="relative grid grid-cols-1 gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur sm:grid-cols-3"
            >
              {activeTrainingStatusOption && activeStatusTabRect.width > 0 && (
                <motion.div
                  className="pointer-events-none absolute z-20 flex items-center justify-between gap-3 rounded-lg bg-[var(--app-accent)] px-3.5 py-2.5 text-left text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--app-accent)_22%,transparent)]"
                  initial={false}
                  animate={{
                    x: activeStatusTabRect.x,
                    y: activeStatusTabRect.y,
                    width: activeStatusTabRect.width,
                    height: activeStatusTabRect.height,
                  }}
                  transition={shouldReduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{activeTrainingStatusOption.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-white/75">{activeTrainingStatusOption.desc}</span>
                  </span>
                  <span className="shrink-0 rounded-md bg-white/22 px-2 py-1 text-xs font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]">
                    {statusCountsLoading && trainingStatusCounts[activeTrainingStatusOption.value] === 0 ? '-' : trainingStatusCounts[activeTrainingStatusOption.value]}
                  </span>
                </motion.div>
              )}
              {trainingStatusOptions.map((option) => {
                const selected = filters.status === option.value;
                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      setStatusTabRef(option.value)(element);
                    }}
                    type="button"
                    onClick={() => setFilters({
                      ...filters,
                      status: option.value,
                      needsElite2: option.value === 'all' ? false : filters.needsElite2
                    })}
                    aria-pressed={selected}
                    className={`group relative z-10 flex min-w-0 items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left transition-colors ${
                      selected
                        ? 'text-transparent'
                        : 'text-secondary hover:bg-white/70 hover:text-primary dark:hover:bg-white/10'
                    }`}
                  >
                    <span className={`min-w-0 ${selected ? 'opacity-0' : ''}`}>
                      <span className="block truncate text-sm font-semibold">{option.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-tertiary">{option.desc}</span>
                    </span>
                    <span className={`shrink-0 rounded-md bg-[var(--app-surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--app-accent-strong)] group-hover:bg-[var(--app-accent-soft)] ${selected ? 'opacity-0' : ''}`}>
                      {statusCountsLoading && trainingStatusCounts[option.value] === 0 ? '-' : trainingStatusCounts[option.value]}
                    </span>
                  </button>
                );
              })}
            </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* 搜索框 */}
            <div className="flex-1 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="搜索干员名称..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-2xl border border-slate-200/80 bg-white/85 py-3 pl-10 pr-4 text-sm text-slate-900 shadow-[0_10px_26px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.75)] outline-none transition-all placeholder:text-slate-400 focus:border-[var(--app-accent)] focus:ring-4 focus:ring-[var(--app-accent-soft)] dark:border-white/10 dark:bg-white/[0.055] dark:text-white dark:shadow-none"
              />
            </div>
            
            {/* 过滤按钮组 */}
            <div className="flex gap-2">
              {/* 稀有度 */}
              <div className="relative filter-menu-container">
                <button
                  onClick={() => setOpenMenu(openMenu === 'rarity' ? null : 'rarity')}
                  className={`h-11 flex items-center space-x-1.5 px-3 rounded-2xl text-xs font-semibold transition-all whitespace-nowrap shadow-sm ${
                    filters.rarity
                      ? 'bg-slate-950 text-white shadow-slate-900/15 dark:bg-white dark:text-slate-950'
                      : 'border border-slate-200/80 bg-white/70 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/10'
                  }`}
                >
                  <span>
                    {filters.rarity ? `${filters.rarity}星` : '全部稀有度'}
                  </span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openMenu === 'rarity' && (
                  <div className="absolute top-full left-0 mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                    {[
                      { value: '', label: '全部' },
                      { value: '6', label: '6星' },
                      { value: '5', label: '5星' },
                      { value: '4', label: '4星' }
                    ].map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setFilters({ ...filters, rarity: option.value });
                          setOpenMenu(null);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                          filters.rarity === option.value
                            ? 'brand-action-subtle font-medium'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 仅未精二 */}
              <button
                onClick={() => setFilters({ ...filters, needsElite2: !filters.needsElite2 })}
                className={`h-11 flex items-center space-x-1.5 px-3 rounded-2xl text-xs font-semibold transition-all whitespace-nowrap shadow-sm ${
                  filters.needsElite2
                    ? 'brand-action'
                    : 'border border-slate-200/80 bg-white/70 text-slate-600 hover:bg-white dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span>仅未精二</span>
              </button>
            </div>
          </div>
          </div>

          {/* 干员卡片列表 */}
          {operatorsLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--app-accent)]"></div>
              <p className="mt-2 text-gray-600 dark:text-gray-400">加载中...</p>
            </div>
          ) : operatorEmptyState ? (
            <OperatorEmptyState {...operatorEmptyState} />
          ) : (
            <div className="min-h-[260px]">
              <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {visibleOperators.map((operator, idx) => {
                  const isInQueue = queue.some(q => q.operatorId === operator.id);
                  const imageLoaded = loadedImages[operator.id] || false;
                  const isOwned = operator.owned !== false;
                  const isAlreadyElite2 = operator.disabledReason === 'already_elite2';
                  const canAdd = Boolean(operator.canTrain) && !isInQueue;
                  const statusLabel = isInQueue
                    ? '已添加'
                    : !isOwned
                      ? '未拥有'
                      : !operator.hasMaterialData
                        ? '暂无数据'
                        : isAlreadyElite2
                          ? '已精二'
                          : '可养成';
                  const actionLabel = isInQueue
                    ? '已添加'
                    : !isOwned
                      ? '未拥有'
                      : !operator.hasMaterialData
                        ? '暂无数据'
                        : isAlreadyElite2
                          ? '已完成'
                          : '添加';

                  return (
                    <motion.div
                      key={operator.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: Math.min(idx, 24) * 0.004 }}
                      className={`group relative overflow-hidden rounded-2xl border p-3 transition-all duration-200 ${
                        canAdd
                          ? 'border-[var(--app-border)] bg-white/80 shadow-[0_10px_26px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] hover:-translate-y-0.5 hover:border-[var(--app-accent)] hover:bg-[var(--app-accent-soft)] hover:shadow-[0_16px_34px_rgba(14,116,144,0.14)] dark:bg-white/[0.045] dark:shadow-none'
                          : isOwned
                            ? 'border-slate-200/80 bg-slate-50/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none'
                            : 'border-slate-200/70 bg-slate-50/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none'
                      }`}
                    >
                    <div className={`absolute top-2 left-2 z-10 rounded-md px-2 py-0.5 text-xs font-bold text-white shadow-sm backdrop-blur-sm ${
                      canAdd
                        ? 'bg-[var(--app-accent)]'
                        : isInQueue
                          ? 'bg-emerald-500/95'
                          : isOwned
                            ? 'bg-slate-500/95'
                            : 'bg-slate-400/95'
                    }`}>
                      {statusLabel}
                    </div>
                    
                    {/* 干员头像 */}
                    <div className="relative mb-3 aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 via-white to-slate-100 ring-1 ring-slate-200/60 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950 dark:ring-white/10">
                      {operator.id ? (
                        <>
                          {/* 骨架屏 */}
                          {!imageLoaded && (
                            <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-100 via-white to-slate-200 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950"></div>
                          )}
                          <img
                            src={`https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${operator.id}.png`}
                            alt={operator.name}
                            loading={idx < 12 ? 'eager' : 'lazy'}
                            decoding="async"
                            className={`w-full h-full object-cover transition-opacity duration-500 ${
                              imageLoaded ? 'opacity-100' : 'opacity-0'
                            } ${canAdd && imageLoaded ? 'group-hover:scale-110 transition-transform duration-300' : ''}`}
                            onLoad={() => setLoadedImages(prev => prev[operator.id] ? prev : ({ ...prev, [operator.id]: true }))}
                            onError={(e) => {
                              // 如果加载失败，尝试带 _2 后缀的版本（用于异格干员）
                              const target = e.target as HTMLImageElement;
                              const currentSrc = target.src;
                              if (!currentSrc.includes('_2.png') && !currentSrc.includes('_1.png')) {
                                target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${operator.id}_2.png`;
                              } else if (currentSrc.includes('_2.png')) {
                                // 如果 _2 也失败，尝试 _1
                                target.src = `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${operator.id}_1.png`;
                              } else {
                                // 都失败了，隐藏图片并标记为已加载
                                target.style.display = 'none';
                                setLoadedImages(prev => prev[operator.id] ? prev : ({ ...prev, [operator.id]: true }));
                              }
                            }}
                          />
                          {/* 不可添加时的半透明蒙版 */}
                          {!canAdd && imageLoaded && (
                            <div className={`absolute inset-0 ${isOwned ? 'bg-white/35 dark:bg-black/20' : 'bg-white/55 dark:bg-black/30'}`}></div>
                          )}
                        </>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-600">
                          无头像
                        </div>
                      )}
                      {/* 稀有度标识 */}
                      {operator.rarity !== undefined && operator.rarity > 0 && (
                        <div className="absolute right-2 top-2 rounded-md bg-[var(--app-accent)] px-1.5 py-0.5 text-xs font-bold text-white shadow-sm backdrop-blur-sm">
                          {operator.rarity}★
                        </div>
                      )}
                    </div>
                    
                    <div className="text-center space-y-2">
                      <div className="truncate text-sm font-semibold text-slate-950 dark:text-white" title={operator.name}>
                        {operator.name || '未知干员'}
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
                        {isOwned && operator.currentElite !== undefined && (
                          <span className="rounded-full px-2 py-0.5 brand-chip whitespace-nowrap">
                            精{operator.currentElite}
                          </span>
                        )}
                        {isOwned && operator.currentLevel !== undefined && operator.currentLevel > 0 && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10 whitespace-nowrap">
                            Lv.{operator.currentLevel}
                          </span>
                        )}
                        {!isOwned && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-slate-400 dark:ring-white/10 whitespace-nowrap">
                            未拥有
                          </span>
                        )}
                      </div>
                      
                      {/* 添加按钮 */}
                      <Button
                        onClick={() => handleAddToQueue(operator)}
                        disabled={!canAdd}
                        variant="gradient"
                        size="sm"
                        fullWidth
                        className="h-8 rounded-lg text-xs"
                      >
                        {actionLabel}
                      </Button>
                    </div>
                    </motion.div>
                  );
                })}
              </div>
              {hiddenOperatorCount > 0 && (
                <div className="flex flex-col items-center gap-2 py-3">
                  <Button
                    onClick={() => setVisibleOperatorLimit(limit => limit + OPERATOR_RENDER_BATCH_SIZE)}
                    variant="secondary"
                    size="md"
                    className="min-w-36"
                  >
                    继续显示 {Math.min(OPERATOR_RENDER_BATCH_SIZE, hiddenOperatorCount)} 个
                  </Button>
                  <div className="text-xs text-tertiary">
                    已显示 {visibleOperators.length} / {filteredOperators.length}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
          </section>

          <aside className={`space-y-4 xl:sticky xl:top-4 ${currentTarget ? 'order-1 xl:order-2' : 'order-2'}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {currentTarget && (
            <div className="relative overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white/90 px-4 py-4 shadow-[0_18px_44px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur dark:bg-white/[0.055] dark:shadow-none">
              <div className="absolute inset-x-0 top-0 h-px bg-[var(--app-accent)]/45" />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="rounded-md brand-action px-2 py-1 text-xs font-semibold shadow-sm">当前养成</span>
                <h3 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-slate-950 dark:text-white">{currentTarget.operator.name}</h3>
                <span className="rounded-md px-2 py-0.5 text-xs font-bold brand-chip">
                  {currentTarget.operator.rarity}★
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70 dark:bg-slate-800 dark:ring-white/10">
                  <motion.div
                    className="h-full rounded-full bg-[var(--app-accent)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${currentProgress}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <div className="text-sm font-bold brand-text">{currentProgress}%</div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/10 dark:bg-white/[0.035] dark:shadow-none">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">阶段</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">精{currentTarget.currentElite} → 精{currentTarget.targetElite}</div>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/10 dark:bg-white/[0.035] dark:shadow-none">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">缺口</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{currentMissingMaterials.length} 种</div>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] dark:border-white/10 dark:bg-white/[0.035] dark:shadow-none">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">后续</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{backlogCount} 个</div>
                </div>
              </div>

              <div className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {currentMissingPreview ? `优先补：${currentMissingPreview}` : '当前目标材料已接近完成'}
              </div>

              <div className="mt-4">
                <MaterialGapList materials={currentMissingMaterials} limit={3} emptyText="当前目标材料已集齐" />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  value={planMode}
                  onChange={(e) => setPlanMode(e.target.value as TrainingPlanMode)}
                  className="h-10 rounded-xl border border-slate-200/80 bg-white/85 px-3 text-sm font-medium text-slate-800 shadow-sm outline-none transition focus:border-[var(--app-accent)] focus:ring-4 focus:ring-[var(--app-accent-soft)] dark:border-white/10 dark:bg-slate-950/70 dark:text-white"
                >
                  <option value="current">仅当前</option>
                  <option value="all">全部队列</option>
                </select>
                <Button
                  onClick={handleGeneratePlan}
                  disabled={loading}
                  variant="gradient"
                  size="sm"
                  className="h-10 rounded-xl"
                  icon={
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  }
                >
                  {loading ? '生成中...' : '生成计划'}
                </Button>
              </div>
            </div>
          )}

          {/* 设置 */}
          <details className="rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900 marker:text-slate-400 dark:text-white">自动化设置</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Checkbox
                checked={settings.autoSwitch}
                onChange={(checked: boolean) => handleUpdateSettings({ ...settings, autoSwitch: checked })}
                label="自动切换"
                className="rounded-lg px-2 py-1.5"
              />

              <Checkbox
                checked={settings.notifyOnComplete}
                onChange={(checked: boolean) => handleUpdateSettings({ ...settings, notifyOnComplete: checked })}
                label="完成通知"
                className="rounded-lg px-2 py-1.5"
              />
            </div>
          </details>

          {/* 队列列表 */}
          {queue.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--app-border-strong)] bg-white/70 px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:bg-white/[0.025] dark:shadow-none">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl icon-well">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">养成队列还是空的</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">在左侧添加要养成的干员，系统会自动接上计划和今日流程。</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-[0_12px_28px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/10">
                <h3 className="text-sm font-bold text-slate-950 dark:text-white">后续队列</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">{upcomingQueue.length} 个待处理</span>
              </div>
              {upcomingQueue.length === 0 ? (
                <div className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">当前只有一个养成目标。</div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-white/10">
                  {upcomingQueue.map((item, index) => (
                    <motion.div
                      key={item.operatorId}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.04 }}
                      className="px-4 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.035]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                          #{index + 2}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-bold text-slate-950 dark:text-white">
                              {item.operator.name}
                            </h3>
                            <span className="rounded-full px-2 py-0.5 text-xs font-bold brand-chip">
                              {item.operator.rarity}★
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70 dark:bg-slate-800 dark:ring-white/10">
                            <motion.div
                              className="h-full rounded-full bg-[var(--app-accent)]"
                              initial={{ width: 0 }}
                              animate={{ width: `${item.progress}%` }}
                              transition={{ duration: 0.6, ease: 'easeOut' }}
                            />
                          </div>
                        </div>
                        <span className="w-9 text-right text-xs font-semibold brand-text">{item.progress}%</span>
                        <IconButton
                          onClick={() => handleRemoveFromQueue(item.operatorId)}
                          variant="ghost"
                          size="sm"
                          title="移除"
                          className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          icon={
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          }
                        />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {!plan ? (
            <div className="rounded-2xl border border-dashed border-[var(--app-border-strong)] bg-white/70 px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:bg-white/[0.025] dark:shadow-none">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl icon-well">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">还没有刷取计划</h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">先在“养成队列”里添加干员并生成计划，系统会在这里展示推荐关卡、材料层级和总理智消耗。</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] brand-text">今日流程</div>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">{planFocusName}</h3>
                    <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      可刷 {openStageCount} 个关卡 · 预计 {todayRunCount} 次 · 完整计划约 {plan.totalSanity || 0} 理智
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <Button
                      onClick={handleApplyPlan}
                      disabled={loading || openStageCount === 0}
                      variant="success"
                      size="sm"
                      className="h-10 rounded-xl"
                      icon={
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      }
                    >
                      {loading ? '应用中...' : '加入今日流程'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-[0_12px_28px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
                <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
                  <h3 className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">今日推荐刷图</h3>
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold brand-chip">
                    {previewStages.length} 个优先
                  </span>
                </div>
                {previewStages.length > 0 ? (
                  <div className="divide-y divide-slate-200 dark:divide-white/10">
                    {previewStages.map((stage, idx) => (
                      <div key={`${stage.stage}-${idx}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.035]">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-500 ring-1 ring-slate-200/70 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10">
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-950 dark:text-white">{stage.stage}</div>
                            <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                              {stage.materials?.slice(0, 2).map((mat: any) => `${mat.name}×${mat.count}`).join('、') || '今日可直接推进'}
                            </div>
                          </div>
                        </div>
                        <div className="flex-shrink-0 rounded-full px-2.5 py-1 text-sm font-bold brand-chip">×{stage.totalTimes || 0}</div>
                      </div>
                    ))}
                    {hiddenStageCount > 0 && (
                      <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                        还有 {hiddenStageCount} 个关卡，展开详情查看完整列表。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">今天没有可直接推进的养成关卡。</div>
                )}
              </div>

              <details className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur dark:border-white/10 dark:bg-white/[0.045] dark:shadow-none">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900 marker:text-slate-400 dark:text-white">查看材料、未开放关卡和计算详情</summary>
                <div className="mt-5 space-y-5">
                  {plan.warnings && plan.warnings.length > 0 && (
                    <div className="rounded-2xl p-4 status-warning">
                      <h4 className="text-sm font-semibold mb-2">注意事项</h4>
                      <ul className="space-y-1 text-sm">
                        {plan.warnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.closedStages && plan.closedStages.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">今日未开放</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {plan.closedStages.map((stage, idx) => (
                          <div key={`${stage.stage}-${idx}`} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-500/20 dark:bg-red-500/5">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-white">{stage.stage}</div>
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  {stage.materials?.slice(0, 2).map((mat: any) => `${mat.name}×${mat.count}`).join('、') || '等待开放后再推进'}
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-red-700 dark:text-red-300">未开放</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.materialHierarchy && plan.materialHierarchy.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">材料缺口</h3>
                      <MaterialGapList materials={plan.materialHierarchy} limit={8} emptyText="计划内材料已集齐" />
                    </div>
                  )}

                  {plan.materialHierarchy && plan.materialHierarchy.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">材料需求</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plan.materialHierarchy.map((hierarchy, index) => (
                          <MaterialHierarchyNode key={`${hierarchy.id}-${index}`} node={hierarchy} />
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.stages && plan.stages.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">完整关卡列表</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plan.stages.map((stage, idx) => (
                          <motion.div
                            key={`${stage.stage}-${idx}`}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx * 0.05 }}
                            className={`group relative p-5 rounded-3xl border transition-all overflow-hidden ${
                              stage.isOpen !== false
                                ? 'border-[var(--app-border)] surface-soft hover:border-[var(--app-accent)] hover:shadow-xl'
                                : 'status-danger'
                            }`}
                          >
                            <div className="relative">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className={`px-3 py-1.5 rounded-xl font-bold text-sm shadow-lg ${
                                    stage.isOpen !== false
                                      ? 'brand-action'
                                      : 'bg-[var(--app-danger)] text-white'
                                  }`}>
                                    {stage.stage}
                                  </div>
                                  {stage.isOpen === false && <div className="text-xs text-red-600 dark:text-red-400 font-medium">未开放</div>}
                                </div>
                                <div className="px-3 py-1.5 rounded-xl text-sm font-bold brand-chip">×{stage.totalTimes || 0}</div>
                              </div>
                              {stage.materials && stage.materials.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {stage.materials.map((mat, matIdx) => (
                                    <div key={matIdx} className="px-3 py-1.5 rounded-xl text-xs font-medium brand-chip">
                                      {mat.name} ×{mat.count}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
        </motion.div>
          </aside>
        </div>
      </div>
    </div>
  );
}
