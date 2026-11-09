import { getResponseErrorMessage } from '@/utils/errorMessage'
import '../styles/pages/training.css'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { GlassSegmented } from '@zakisheriff/liquid-glass'
import {
  AlertCircle,
  Check,
  ClipboardList,
  Filter,
  GraduationCap,
  Package,
  Search,
  Sparkles,
  Trash2,
  UserRoundSearch,
} from 'lucide-react'
import { getOperatorList, getOperatorCounts, getAllOperators, getOperBoxData, getTrainingQueue, addToTrainingQueue, removeFromTrainingQueue, updateTrainingQueueOrder, updateTrainingSettings, generateTrainingPlan, applyTrainingPlan, getItemIconUrl } from '../services/api'
import { getOperatorAvatarUrl } from '../services/operatorQuotes'
import { PageHeader, Card, SmoothPanel, Button, EmptyState, IconButton, Input, Loading, Select, Switch, CjkText, TruncatedText, SwipeModePager } from './common'
import { keepNumberWithUnit } from '../utils/typography'
import { useStatusStore } from '../store/statusStore'
import { useUIStore } from '../stores'
import MasteryTrainingWorkspace from './training/MasteryTrainingWorkspace'
import FloatingStatusIndicator from './FloatingStatusIndicator'
import { useItemIconCacheVersion } from '../hooks/useItemIconCacheVersion'
import { useSwipeModeTrack } from '../hooks/useSwipeModeTrack'
import type {
  MaterialHierarchyNodeProps,
  TrainingOperator,
  TrainingQueueItem,
  TrainingSettings,
  TrainingPlan,
  MaterialNode,
  TrainingFilters,
  TrainingPlanMode,
} from '@/types/components'

const TRAINING_STATUS_OPTIONS: Array<{
  value: TrainingFilters['status']
  label: string
  desc: string
}> = [
  { value: 'trainable', label: '可养成', desc: '可加入队列' },
  { value: 'owned', label: '已拥有', desc: '全部已拥有' },
  { value: 'all', label: '全部', desc: '全部干员' },
]

// 材料层级节点组件
function MaterialHierarchyNode({ node, depth = 0 }: MaterialHierarchyNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  
  const getColorByDepth = (_d: number): string => 'bg-[var(--app-accent)] text-white';
  
  const getBgColorByDepth = (): string => 'surface-soft';
  
  // 只有顶层材料才返回完整的卡片结构
  if (depth === 0) {
    return (
      <div className="space-y-3 rounded-xl p-3 surface-soft">
        {/* 顶层材料 */}
        <div className="rounded-xl p-1">
          <div className="flex items-center gap-3">
            {/* 材料图标 */}
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl surface-panel">
              {node.iconId ? (
                <img
                  src={getItemIconUrl(node.iconId)}
                  alt={node.name}
                  className="maa-item-icon w-full h-full object-cover"
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
                <span className="text-sm font-bold text-primary">
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
                    <span className="text-tertiary">拥有 </span>
                    <span className="font-bold text-[var(--app-success-text)]">{node.have}</span>
                  </div>
                  <span className="text-tertiary">/</span>
                  <div>
                    <span className="text-tertiary">需要 </span>
                    <span className="font-bold text-secondary">{node.needed}</span>
                  </div>
                </div>
                
                {node.stillNeeded > 0 ? (
                  <div className="rounded-lg px-3 py-1 text-center brand-chip">
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
          <div className="space-y-2 border-l border-[var(--app-border)] pl-3">
            {node.children.map((child, index) => (
              <MaterialHierarchyNode key={`${child.id}-${index}`} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }
  
  // 子材料的简化显示
  return (
    <div className={`rounded-lg p-2.5 ${getBgColorByDepth()}`}>
      <div className="flex items-center gap-2">
        {/* 材料图标 */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg surface-panel">
          {node.iconId ? (
            <img
              src={getItemIconUrl(node.iconId)}
              alt={node.name}
              className="maa-item-icon w-full h-full object-cover"
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
            <TruncatedText className="text-xs font-semibold text-primary" tooltip={node.name} triggerClassName="flex-1 min-w-0">
              {node.name}
            </TruncatedText>
            {node.stillNeeded > 0 ? (
              <span className="rounded px-2 py-0.5 text-xs font-bold brand-chip">
                -{node.stillNeeded}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded status-success font-bold text-xs">✓</span>
            )}
          </div>
          
          <div className="flex items-center gap-2 text-xs">
            <span className="text-tertiary">
              <span className="font-semibold text-[var(--app-success-text)]">{node.have}</span> / {node.needed}
            </span>
          </div>
        </div>
      </div>
      
      {/* 递归子材料 */}
      {hasChildren && node.children && (
        <div className="mt-2 space-y-1.5 border-l border-[var(--app-border)] pl-3">
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
      <div className="rounded-xl px-4 py-4 text-sm text-tertiary surface-soft">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {visibleMaterials.map((material) => (
        <div
          key={material.id}
          className="flex min-h-[60px] items-center gap-3 rounded-xl px-3 py-2 surface-soft"
        >
          <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl surface-panel text-tertiary">
            <Package size={16} strokeWidth={1.8} aria-hidden="true" />
            {material.iconId && (
              <img
                src={getItemIconUrl(material.iconId)}
                alt=""
                className="maa-item-icon absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <TruncatedText as="div" className="text-sm font-semibold text-primary" tooltip={material.name}>{material.name}</TruncatedText>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tertiary">
              <span>{material.have}/{material.needed}</span>
              <span className="rounded-full px-1.5 py-0.5 font-semibold status-danger">缺 {material.stillNeeded}</span>
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="flex min-h-[60px] items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-tertiary surface-soft">
          {keepNumberWithUnit(`还有 ${hiddenCount} 种材料`)}
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
    <EmptyState
      compact
      className="py-8"
      icon={<UserRoundSearch size={21} strokeWidth={1.8} />}
      title={title}
      description={description}
    />
  );
}

function TrainingLoadError({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-xl px-6 py-8 text-center status-danger" role="alert">
      <AlertCircle size={22} strokeWidth={1.9} aria-hidden="true" />
      <div className="max-w-md">
        <h3 className="text-base font-semibold"><CjkText>{title}</CjkText></h3>
        <p className="mt-1 text-sm leading-6">{description}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重新加载
      </Button>
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

const extractOperatorRows = (payload: unknown): FallbackOperatorRow[] => {
  const data = payload as { operators?: FallbackOperatorRow[]; data?: FallbackOperatorRow[] } | FallbackOperatorRow[] | null | undefined;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.operators)) return data.operators;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

export default function OperatorTraining() {
  useItemIconCacheVersion()
  const shouldReduceMotion = useReducedMotion();
  const { setMessage: setStatusMessage } = useStatusStore()
  const trainingMode = useUIStore(state => state.trainingMode)
  const setTrainingMode = useUIStore(state => state.setTrainingMode)

  // 辅助函数：使用 statusMessage 显示消息
  const showSuccess = (msg: string) => {
    setStatusMessage(msg, 'success')
  }
  const showError = (msg: string) => {
    setStatusMessage(msg, 'error')
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
  const [operatorsError, setOperatorsError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
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
  const [pendingOperatorIds, setPendingOperatorIds] = useState<Set<string>>(new Set());
  const [recentlyRemoved, setRecentlyRemoved] = useState<{ item: TrainingQueueItem; index: number } | null>(null);

  useEffect(() => {
    if (!recentlyRemoved) return undefined
    const timer = window.setTimeout(() => setRecentlyRemoved(null), 8_000)
    return () => window.clearTimeout(timer)
  }, [recentlyRemoved])
  const operatorsRequestRef = useRef(0);
  const statusCountsRequestRef = useRef(0);
  const operatorsAbortRef = useRef<AbortController | null>(null);
  const statusCountsAbortRef = useRef<AbortController | null>(null);
  const trainingStatusShellRef = useRef<HTMLDivElement>(null);
  const settingsRequestRef = useRef(0);
  const queueRequestRef = useRef(0);
  const settingsWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistedSettingsRef = useRef(settings);
  const queueMutationInFlightRef = useRef(false);

  const handleTrainingStatusChange = (status: TrainingFilters['status']) => {
    setFilters(current => ({
      ...current,
      status,
      needsElite2: status === 'all' ? false : current.needsElite2,
    }));
  };

  const trainingStatusIndex = Math.max(
    0,
    TRAINING_STATUS_OPTIONS.findIndex(option => option.value === filters.status),
  );
  const trainingTrack = useSwipeModeTrack({
    count: TRAINING_STATUS_OPTIONS.length,
    index: trainingStatusIndex,
    onChange: (index) => {
      const option = TRAINING_STATUS_OPTIONS[index];
      if (option) handleTrainingStatusChange(option.value);
    },
    extraIgnoreSelector: '.training-status-shell',
  });

  const getOpenStagePlan = (sourcePlan: TrainingPlan): TrainingPlan => ({
    ...sourcePlan,
    stages: sourcePlan.openStages ?? sourcePlan.stages?.filter(stage => stage.isOpen !== false) ?? []
  });

  const getOpenStageCount = (sourcePlan: TrainingPlan | null): number => {
    if (!sourcePlan) return 0;
    return sourcePlan.openStages?.length ?? sourcePlan.stages?.filter(stage => stage.isOpen !== false).length ?? 0;
  };

  const loadTrainingStatusCounts = useCallback(async () => {
    const requestId = ++statusCountsRequestRef.current;
    const controller = new AbortController()
    statusCountsAbortRef.current?.abort()
    statusCountsAbortRef.current = controller
    setStatusCountsLoading(true);
    try {
      const rarity = filters.rarity ? parseInt(filters.rarity) : undefined;
      const response = await getOperatorCounts({ rarity }, controller.signal);
      if (requestId !== statusCountsRequestRef.current) return;
      if (!response.success || !response.data) {
        throw new Error(response.message || '养成状态计数加载失败');
      }

      const counts = response.data;
      setTrainingStatusCounts(prev => ({
        trainable: counts.trainable,
        owned: counts.owned,
        all: counts.all > 0 ? counts.all : prev.all
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      // 静默失败，保留上一次统计
    } finally {
      if (statusCountsAbortRef.current === controller) statusCountsAbortRef.current = null;
      if (requestId === statusCountsRequestRef.current) setStatusCountsLoading(false);
    }
  }, [filters.rarity]);

  useEffect(() => {
    setVisibleOperatorLimit(OPERATOR_RENDER_BATCH_SIZE);
  }, [filters.status, filters.rarity, filters.needsElite2, searchTerm]);

  // GlassSegmented 会用自己的 aria-label 覆盖按钮内容，数量需要手动补进可访问名称。
  useEffect(() => {
    const items = trainingStatusShellRef.current?.querySelectorAll<HTMLButtonElement>(
      '.lg-track:not([data-lg-copy]) > .lg-track__item',
    )
    items?.forEach((item, index) => {
      const option = TRAINING_STATUS_OPTIONS[index]
      if (!option) return
      const count = statusCountsLoading && trainingStatusCounts[option.value] === 0
        ? '数量读取中'
        : `${trainingStatusCounts[option.value]} 名`
      item.setAttribute('aria-label', `${option.label}，${count}`)
    })
  }, [statusCountsLoading, trainingStatusCounts]);

  // 加载养成队列
  useEffect(() => {
    void loadQueue(true);
  }, []);

  const loadOperators = useCallback(async () => {
    const requestId = ++operatorsRequestRef.current;
    const requestedFilters = { rarity: filters.rarity, needsElite2: filters.needsElite2 };
    const controller = new AbortController();
    operatorsAbortRef.current?.abort();
    operatorsAbortRef.current = controller;
    try {
      setOperatorsLoading(true);
      setOperatorsError(null);
      // Load the full catalog once; the three status slides derive from it so
      // the adjacent card already has data while the finger drags.
      const response = await getOperatorList({
        ...requestedFilters,
        status: 'all',
        rarity: requestedFilters.rarity ? parseInt(requestedFilters.rarity) : undefined
      }, controller.signal);
      if (requestId !== operatorsRequestRef.current || controller.signal.aborted) return;
      if (!response.success) {
        throw new Error(response.message || response.errorInfo?.message || response.error || '干员列表加载失败');
      }
      if (response.success) {
        // 适配新的响应格式：data.operators 是数组
        const operatorPayload = response.data;
        let nextOperators: TrainingOperator[] = Array.isArray(operatorPayload)
          ? operatorPayload
          : operatorPayload?.operators ?? [];

        if (nextOperators.length === 0) {
          const [allOperatorsResponse, operBoxResponse] = await Promise.all([
            getAllOperators(),
            getOperBoxData()
          ]);

          if (allOperatorsResponse.success) {
            const allOperators: FallbackOperatorRow[] = extractOperatorRows(allOperatorsResponse.data);
            const operBoxPayload = operBoxResponse.success ? operBoxResponse.data : null;
            const ownedOperators: FallbackOperatorRow[] = extractOperatorRows(operBoxPayload);
            const ownedMap = new Map(ownedOperators.map(operator => [operator.id, operator]));
            if (requestId !== operatorsRequestRef.current) return;
            const rarityFilter = requestedFilters.rarity ? parseInt(requestedFilters.rarity) : null;

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
            if (requestedFilters.needsElite2) {
              nextOperators = nextOperators.filter(operator => !(operator.owned && operator.currentElite >= 2));
            }
          } else {
            throw new Error(allOperatorsResponse.message || allOperatorsResponse.errorInfo?.message || allOperatorsResponse.error || '完整干员列表加载失败');
          }
        }

        if (requestId === operatorsRequestRef.current) setOperators(nextOperators);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (requestId === operatorsRequestRef.current) {
        setOperators([]);
        setOperatorsError(error instanceof Error && error.message ? error.message : '干员列表加载失败，请稍后重试');
      }
    } finally {
      if (operatorsAbortRef.current === controller) operatorsAbortRef.current = null;
      if (requestId === operatorsRequestRef.current) setOperatorsLoading(false);
    }
  }, [filters.needsElite2, filters.rarity]);

  // 加载干员列表
  useEffect(() => {
    void loadOperators();
  }, [loadOperators]);

  useEffect(() => {
    void loadTrainingStatusCounts();
  }, [loadTrainingStatusCounts]);

  useEffect(() => () => {
    operatorsAbortRef.current?.abort();
    statusCountsAbortRef.current?.abort();
  }, []);

  const loadQueue = async (syncSettings = false) => {
    const requestId = ++queueRequestRef.current;
    const settingsRevision = settingsRequestRef.current;
    if (syncSettings) {
      setQueueLoading(true);
      setQueueError(null);
    }
    try {
      const response = await getTrainingQueue();
      if (requestId !== queueRequestRef.current) return null;
      if (!response.success) {
        throw new Error(response.message || response.errorInfo?.message || response.error || '养成队列加载失败');
      }
      if (!Array.isArray(response.data?.queue)) {
        throw new Error('养成队列数据格式不正确');
      }
      if (response.success && response.data?.queue) {
        setQueue(response.data.queue);
        setQueueError(null);
        if (syncSettings && settingsRevision === settingsRequestRef.current && response.data.settings) {
          persistedSettingsRef.current = response.data.settings;
          setSettings(response.data.settings);
        }
        return response.data;
      }
    } catch (error) {
      if (syncSettings && requestId === queueRequestRef.current) {
        setQueueError(error instanceof Error && error.message ? error.message : '养成队列加载失败，请稍后重试');
      }
    } finally {
      if (requestId === queueRequestRef.current) setQueueLoading(false);
    }
    return null;
  };

  const setOperatorPending = (operatorId: string, pending: boolean) => {
    setPendingOperatorIds(current => {
      const next = new Set(current);
      if (pending) next.add(operatorId);
      else next.delete(operatorId);
      return next;
    });
  };

  const handleAddToQueue = async (operator: TrainingOperator) => {
    if (queueMutationInFlightRef.current) {
      showInfo('养成队列正在更新，请稍候');
      return;
    }

    queueMutationInFlightRef.current = true;
    setOperatorPending(operator.id, true);
    setRecentlyRemoved(null);
    try {
      setStatusMessage('正在添加干员...');
      
      const response = await addToTrainingQueue({
        operatorId: operator.id,
        currentElite: operator.currentElite ?? 0,
        targetElite: operator.targetElite ?? 2
      });

      if (response.success) {
        const queueData = await loadQueue();
        setPlan(null);

        if (!queueData) {
          const optimisticItem: TrainingQueueItem = {
            operatorId: operator.id,
            operator: {
              name: operator.name,
              rarity: operator.rarity,
              profession: operator.profession
            },
            currentElite: operator.currentElite ?? 0,
            targetElite: operator.targetElite ?? 2,
            materials: [],
            progress: 0
          };
          setQueue(current => current.some(item => item.operatorId === operator.id)
            ? current
            : [...current, optimisticItem]);
          setStatusMessage(`${operator.name} 已添加，但队列刷新失败，请稍后重试`, 'warning');
          return;
        }

        const addedIsCurrent = queueData?.queue?.[0]?.operatorId === operator.id;
        if (!addedIsCurrent) {
          setStatusMessage(`${operator.name} 已加入队列，将在当前目标完成后处理`, 'success');
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
              setStatusMessage('今天没有可直接加入流程的开放关卡', 'warning');
              return;
            }

            setStatusMessage('正在应用到作战任务...');

            // 自动应用到作战任务
            try {
              const applyResponse = await applyTrainingPlan({
                plan: todayPlan,
                settings
              });
              if (applyResponse.success) {
                window.dispatchEvent(new CustomEvent('training-plan-applied', {
                  detail: { stageCount: applyResponse.data?.stageCount ?? todayPlan.stages.length }
                }));
                setStatusMessage('刷取计划已应用到作战任务！', 'success');
              } else {
                setStatusMessage('应用失败', 'error');
              }
            } catch (applyError) {
              setStatusMessage('应用失败', 'error');
            }
          } else {
            setStatusMessage('生成计划失败', 'error');
          }
        } catch (planError) {
          setStatusMessage('生成计划失败', 'error');
        }
      } else {
        setStatusMessage('添加失败', 'error');
      }
    } catch {
      setStatusMessage('添加失败', 'error');
    } finally {
      queueMutationInFlightRef.current = false;
      setOperatorPending(operator.id, false);
    }
  };

  const handleRemoveFromQueue = async (operatorId: string) => {
    if (queueMutationInFlightRef.current) {
      showInfo('养成队列正在更新，请稍候');
      return;
    }

    const removedIndex = queue.findIndex(item => item.operatorId === operatorId);
    const removedItem = removedIndex >= 0 ? queue[removedIndex] ?? null : null;
    queueMutationInFlightRef.current = true;
    setOperatorPending(operatorId, true);
    try {
      setStatusMessage('正在删除...');
      const response = await removeFromTrainingQueue(operatorId);
      if (response.success) {
        const queueData = await loadQueue();
        setPlan(null);
        if (removedItem) setRecentlyRemoved({ item: removedItem, index: removedIndex });
        if (!queueData) {
          setQueue(current => current.filter(item => item.operatorId !== operatorId));
          setStatusMessage('已移除，但队列刷新失败，请稍后重试', 'warning');
        } else {
          setStatusMessage('已从养成队列移除', 'success');
        }
      } else {
        setStatusMessage('删除失败', 'error');
      }
    } catch (error) {
      setStatusMessage('删除失败', 'error');
    } finally {
      queueMutationInFlightRef.current = false;
      setOperatorPending(operatorId, false);
    }
  };

  const handleUndoRemove = async () => {
    const snapshot = recentlyRemoved;
    if (!snapshot || queueMutationInFlightRef.current) return;

    queueMutationInFlightRef.current = true;
    setOperatorPending(snapshot.item.operatorId, true);
    let itemWasAdded = false;
    try {
      const response = await addToTrainingQueue({
        operatorId: snapshot.item.operatorId,
        currentElite: snapshot.item.currentElite,
        targetElite: snapshot.item.targetElite
      });
      if (!response.success) throw new Error('恢复失败');
      itemWasAdded = true;

      const restoredQueue = queue.filter(item => item.operatorId !== snapshot.item.operatorId);
      restoredQueue.splice(Math.min(snapshot.index, restoredQueue.length), 0, snapshot.item);
      const orderResponse = await updateTrainingQueueOrder(restoredQueue.map(item => item.operatorId));
      if (!orderResponse.success) throw new Error('顺序恢复失败');

      const queueData = await loadQueue();
      setRecentlyRemoved(null);
      if (!queueData) {
        setQueue(restoredQueue);
        setStatusMessage(`${snapshot.item.operator.name} 已恢复，但队列刷新失败`, 'warning');
      } else {
        setStatusMessage(`${snapshot.item.operator.name} 已恢复到养成队列`, 'success');
      }
    } catch (error) {
      if (itemWasAdded) {
        const queueData = await loadQueue();
        if (!queueData) {
          setQueue(current => current.some(item => item.operatorId === snapshot.item.operatorId)
            ? current
            : [...current, snapshot.item]);
        }
        setRecentlyRemoved(null);
        setStatusMessage('干员已恢复，但原队列顺序恢复失败', 'error');
      } else {
        setStatusMessage('撤销失败，请重新添加干员', 'error');
      }
    } finally {
      queueMutationInFlightRef.current = false;
      setOperatorPending(snapshot.item.operatorId, false);
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
      if (response.success && response.data) {
        setPlan(response.data);
        showSuccess('刷取计划生成成功！');
      }
    } catch (error) {
      showError(getResponseErrorMessage(error) || '生成计划失败');
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
    } catch (error) {
      showError(getResponseErrorMessage(error) || '应用失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = (newSettings: TrainingSettings) => {
    const requestId = ++settingsRequestRef.current;
    setSettings(newSettings);

    settingsWriteQueueRef.current = settingsWriteQueueRef.current.then(async () => {
      try {
        const response = await updateTrainingSettings(newSettings);
        if (response.success) {
          const savedSettings = response.data ?? newSettings;
          persistedSettingsRef.current = savedSettings;
          if (requestId === settingsRequestRef.current) setSettings(savedSettings);
          return;
        }
      } catch (error) {
        // The latest requested value is restored below when its write fails.
      }

      if (requestId === settingsRequestRef.current) {
        setSettings(persistedSettingsRef.current);
        showError('设置保存失败，已恢复原设置');
      }
    });
  };

  // 过滤干员
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredOperators = operators.filter(op => {
    if (normalizedSearchTerm && !op.name.toLowerCase().includes(normalizedSearchTerm)) {
      return false;
    }
    return true;
  });
  // The catalog is one fetch filtered by rarity/elite; each status slide slices
  // it locally so the adjacent card is ready during a swipe.
  const operatorsByStatus: Record<TrainingFilters['status'], TrainingOperator[]> = {
    trainable: filteredOperators.filter(op => op.canTrain),
    owned: filteredOperators.filter(op => op.owned),
    all: filteredOperators,
  };
  const getOperatorEmptyState = (status: TrainingFilters['status']): OperatorEmptyStateProps | null => {
    if (operatorsLoading || operatorsByStatus[status].length > 0) return null;
    if (normalizedSearchTerm || filters.rarity) {
      return {
        title: '没有找到符合条件的干员',
        description: '换个名称、稀有度或状态筛选再试。'
      };
    }

    if (status === 'trainable') {
      return {
        title: '没有可养成干员',
        description: '当前没有可直接加入队列的干员，可以切到“已拥有”或“全部”查看其他状态。'
      };
    }

    if (status === 'owned') {
      return {
        title: '还没有已拥有干员',
        description: '请先在“数据统计”页面识别干员，或切到“全部”查看完整干员列表。'
      };
    }

    return {
      title: '没有干员数据',
      description: '全量干员数据暂不可用，请先更新资源或稍后重试。'
    };
  };
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
  const queueMutationPending = pendingOperatorIds.size > 0;
  const renderOperatorList = (status: TrainingFilters['status']) => {
    if (operatorsLoading) {
      return (
        <div className="flex min-h-[260px] items-center justify-center">
          <Loading text="正在读取干员..." />
        </div>
      );
    }
    if (operatorsError) {
      return (
        <TrainingLoadError
          title="干员列表加载失败"
          description={operatorsError}
          onRetry={() => void loadOperators()}
        />
      );
    }
    const emptyState = getOperatorEmptyState(status);
    if (emptyState) return <OperatorEmptyState {...emptyState} />;

    const statusOperators = operatorsByStatus[status];
    const visibleStatusOperators = statusOperators.slice(0, visibleOperatorLimit);
    const hiddenStatusCount = Math.max(statusOperators.length - visibleStatusOperators.length, 0);

    return (
      <div className="min-h-[260px]">
        <div className="training-operator-grid grid grid-cols-3 overflow-hidden rounded-xl surface-soft sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-4 2xl:grid-cols-6">
          {visibleStatusOperators.map((operator, idx) => {
            const isInQueue = queue.some(q => q.operatorId === operator.id);
            const imageLoaded = loadedImages[operator.id] || false;
            const isOwned = operator.owned !== false;
            const isAlreadyElite2 = operator.disabledReason === 'already_elite2';
            const canAdd = Boolean(operator.canTrain) && !isInQueue;
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
              <div
                key={operator.id}
                className={`training-operator-item relative overflow-hidden p-2.5 ${!isOwned ? 'opacity-75' : ''}`}
              >
              {/* 干员头像 */}
              <div className="relative mb-2.5 aspect-square w-full overflow-hidden rounded-xl surface-panel">
                {operator.id ? (
                  <>
                    {/* 骨架屏 */}
                    {!imageLoaded && (
                      <div className="app-skeleton absolute inset-0 surface-soft" />
                    )}
                    <img
                      src={getOperatorAvatarUrl(operator.id)}
                      alt={operator.name}
                      loading={idx < 12 ? 'eager' : 'lazy'}
                      decoding="async"
                      className={`h-full w-full object-cover transition-opacity duration-200 ${
                        imageLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      onLoad={() => setLoadedImages(prev => prev[operator.id] ? prev : ({ ...prev, [operator.id]: true }))}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        setLoadedImages(prev => prev[operator.id] ? prev : ({ ...prev, [operator.id]: true }));
                      }}
                    />
                    {/* 不可添加时的半透明蒙版 */}
                    {!canAdd && imageLoaded && (
                      <div className={`absolute inset-0 ${isOwned ? 'bg-[var(--app-surface)]/25' : 'bg-[var(--app-surface)]/50'}`} />
                    )}
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-tertiary">
                    无头像
                  </div>
                )}
                {/* 稀有度标识 */}
                {operator.rarity !== undefined && operator.rarity > 0 && (
                  <div className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold surface-panel brand-text">
                    {operator.rarity}★
                  </div>
                )}
              </div>

              <div className="space-y-2 text-center">
                <div className="truncate text-sm font-semibold text-primary" title={operator.name}>
                  {operator.name || '未知干员'}
                </div>
                <div className="flex min-h-5 flex-wrap items-center justify-center gap-1 text-xs">
                  {isOwned && operator.currentElite !== undefined && (
                    <span className="whitespace-nowrap rounded-full px-2 py-0.5 surface-panel text-secondary">
                      {keepNumberWithUnit(`精${operator.currentElite}${operator.currentLevel ? ` · ${operator.currentLevel} 级` : ''}`)}
                    </span>
                  )}
                </div>

                {/* 添加按钮 */}
                <Button
                  onClick={() => handleAddToQueue(operator)}
                  disabled={!canAdd || (queueMutationPending && !pendingOperatorIds.has(operator.id))}
                  loading={pendingOperatorIds.has(operator.id)}
                  loadingText="添加中"
                  variant={canAdd ? 'primary' : 'secondary'}
                  size="sm"
                  fullWidth
                >
                  {actionLabel}
                </Button>
              </div>
              </div>
            );
          })}
        </div>
        {hiddenStatusCount > 0 && (
          <div className="flex flex-col items-center gap-2 py-3">
            <Button
              onClick={() => setVisibleOperatorLimit(limit => limit + OPERATOR_RENDER_BATCH_SIZE)}
              variant="secondary"
              size="md"
              className="min-w-36"
            >
              继续显示 {Math.min(OPERATOR_RENDER_BATCH_SIZE, hiddenStatusCount)} 个
            </Button>
            <div className="text-xs text-tertiary">
              已显示 {visibleStatusOperators.length} / {statusOperators.length}
            </div>
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="app-page ios-workspace-page ios-borderless-cards" data-page="training">
      <div className="app-stack-section">
        {/* 页面标题 */}
        <PageHeader
          title="养成"
          subtitle={trainingMode === 'mastery' ? '规划干员技能专精与自动训练队列' : '整理干员目标、材料缺口与今日刷取流程'}
          mobileLayout="inline"
          actions={<FloatingStatusIndicator />}
        />

        <div className="training-mode-row">
          <span className="training-mode-label text-xs font-medium text-tertiary">养成方式</span>
          <div className="training-mode-shell">
            <GlassSegmented
              options={[
                { label: '精英化', icon: <GraduationCap size={14} strokeWidth={1.9} aria-hidden="true" /> },
                { label: '技能专精', icon: <Sparkles size={14} strokeWidth={1.9} aria-hidden="true" /> },
              ]}
              value={trainingMode === 'mastery' ? 1 : 0}
              onChange={(index) => {
                if (index === 0) setTrainingMode('elite')
                else setTrainingMode('mastery')
              }}
              aria-label="养成方式"
            />
          </div>
        </div>

        {trainingMode === 'elite' && (
        <div className="grid grid-cols-1 items-start gap-[var(--app-space-section)] xl:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]">
          <section
            className={`training-operator-column min-w-0 space-y-4 app-swipe-surface ${currentTarget ? 'order-2 xl:order-1' : 'order-1'}`}
            {...trainingTrack.handlers}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary"><CjkText>添加干员</CjkText></h2>
                <p className="text-sm text-secondary">筛选并加入养成队列</p>
              </div>
              <div className="rounded-full px-3 py-1 text-xs font-medium text-tertiary surface-soft">
                {keepNumberWithUnit(`队列 ${queue.length} · 今日计划 ${openStageCount} 个关卡`)}
              </div>
            </div>
        <div className="space-y-4">
          {/* 搜索和过滤 */}
          <div className="flex flex-col gap-3">
            <div className="training-status-shell" ref={trainingStatusShellRef}>
              <GlassSegmented
                options={TRAINING_STATUS_OPTIONS.map((option) => {
                  const count = statusCountsLoading && trainingStatusCounts[option.value] === 0
                    ? '-'
                    : trainingStatusCounts[option.value];
                  return {
                    label: option.label,
                    icon: <span className="training-status-count" aria-hidden="true">{count}</span>,
                  };
                })}
                value={Math.max(0, TRAINING_STATUS_OPTIONS.findIndex(option => option.value === filters.status))}
                onChange={(index) => {
                  if (trainingTrack.isAnimating()) return
                  const option = TRAINING_STATUS_OPTIONS[index];
                  if (option) handleTrainingStatusChange(option.value);
                }}
                aria-label="干员范围"
                className="training-status-segmented"
              />
            </div>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Input
              type="text"
              aria-label="搜索干员名称"
              placeholder="搜索干员"
              value={searchTerm}
              onChange={setSearchTerm}
              icon={<Search size={17} strokeWidth={1.9} aria-hidden="true" />}
              className="col-span-2 min-w-0 sm:col-span-1"
            />
            <Select
              aria-label="稀有度"
              value={filters.rarity}
              onChange={(rarity) => setFilters({ ...filters, rarity })}
              options={[
                { value: '', label: '全部稀有度' },
                { value: '6', label: '6 星' },
                { value: '5', label: '5 星' },
                { value: '4', label: '4 星' },
              ]}
              className="min-w-0"
            />
            <Button
              type="button"
              variant={filters.needsElite2 ? 'primary' : 'secondary'}
              size="md"
              onClick={() => setFilters({ ...filters, needsElite2: !filters.needsElite2 })}
              aria-pressed={filters.needsElite2}
              icon={<Filter size={15} strokeWidth={1.9} aria-hidden="true" />}
              className="whitespace-nowrap"
            >
              未精二
            </Button>
          </div>
          </div>

          <SwipeModePager
            track={trainingTrack}
            index={trainingStatusIndex}
            className="training-operator-pager"
          >
            {TRAINING_STATUS_OPTIONS.map(option => renderOperatorList(option.value))}
          </SwipeModePager>
        </div>
          </section>

          <aside className={`training-support-column min-w-0 space-y-4 xl:sticky xl:top-4 ${currentTarget ? 'order-1 xl:order-2' : 'order-2'}`}>
        <div className="space-y-4">
          {currentTarget && (
            <Card smoothCorners className="training-current-card !p-0">
              <div className="px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold brand-chip">当前目标</span>
                  <TruncatedText as="h3" className="min-w-0 flex-1 text-xl font-semibold text-primary" tooltip={currentTarget.operator.name} triggerClassName="flex-1 min-w-0">{currentTarget.operator.name}</TruncatedText>
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold surface-soft brand-text">
                    {currentTarget.operator.rarity}★
                  </span>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="h-2 overflow-hidden rounded-full surface-soft">
                    <motion.div
                      className="h-full rounded-full bg-[var(--app-accent)]"
                      initial={shouldReduceMotion ? false : { width: 0 }}
                      animate={{ width: `${currentProgress}%` }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.6, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="text-sm font-bold brand-text">{currentProgress}%</div>
                </div>

                <div className="mt-4 grid grid-cols-3 border-y border-[var(--app-border)]">
                  <div className="min-w-0 px-2 py-3 text-center">
                    <div className="text-xs font-medium text-tertiary">阶段</div>
                    <div className="mt-1 text-sm font-semibold text-primary">精{currentTarget.currentElite} → 精{currentTarget.targetElite}</div>
                  </div>
                  <div className="min-w-0 border-l border-[var(--app-border)] px-2 py-3 text-center">
                    <div className="text-xs font-medium text-tertiary">缺口</div>
                    <div className="mt-1 text-sm font-semibold text-primary">{keepNumberWithUnit(`${currentMissingMaterials.length} 种`)}</div>
                  </div>
                  <div className="min-w-0 border-l border-[var(--app-border)] px-2 py-3 text-center">
                    <div className="text-xs font-medium text-tertiary">后续</div>
                    <div className="mt-1 text-sm font-semibold text-primary">{keepNumberWithUnit(`${backlogCount} 个`)}</div>
                  </div>
                </div>

                <div className="mt-3 text-sm leading-6 text-secondary">
                  {currentMissingPreview ? `优先补：${currentMissingPreview}` : '当前目标材料已接近完成'}
                </div>

                <div className="mt-4">
                  <MaterialGapList materials={currentMissingMaterials} limit={3} emptyText="当前目标材料已集齐" />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Select
                    aria-label="计划范围"
                    value={planMode}
                    onChange={(mode) => setPlanMode(mode as TrainingPlanMode)}
                    options={[
                      { value: 'current', label: '仅当前目标' },
                      { value: 'all', label: '全部队列' },
                    ]}
                    className="min-w-0"
                  />
                  <Button
                    onClick={handleGeneratePlan}
                    disabled={loading}
                    loading={loading}
                    loadingText="生成中"
                    variant="primary"
                    size="md"
                    icon={<Sparkles size={15} strokeWidth={1.9} aria-hidden="true" />}
                  >
                    生成计划
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* 设置 */}
          <SmoothPanel cornerSize="compact" className="training-settings-panel">
            <section className="w-full px-4 py-3" aria-labelledby="training-automation-settings-title">
              <h3
                id="training-automation-settings-title"
                className="flex min-h-11 items-center text-sm font-semibold text-primary"
              >
                <CjkText>自动化设置</CjkText>
              </h3>
              <div className="mt-2 divide-y divide-[var(--app-border)]">
                <div className="flex min-h-14 items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-primary">自动切换</div>
                    <p className="mt-0.5 text-xs text-tertiary">当前目标完成后继续下一个</p>
                  </div>
                  <Switch
                    compact
                    checked={settings.autoSwitch}
                    onChange={(checked: boolean) => handleUpdateSettings({ ...settings, autoSwitch: checked })}
                    label="自动切换"
                  />
                </div>
                <div className="flex min-h-14 items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-primary">完成通知</div>
                    <p className="mt-0.5 text-xs text-tertiary">养成目标完成后发送通知</p>
                  </div>
                  <Switch
                    compact
                    checked={settings.notifyOnComplete}
                    onChange={(checked: boolean) => handleUpdateSettings({ ...settings, notifyOnComplete: checked })}
                    label="完成通知"
                  />
                </div>
              </div>
            </section>
          </SmoothPanel>

          {/* 队列列表 */}
          {queueLoading ? (
            <SmoothPanel className="training-queue-loading" surfaceClassName="px-6 py-12">
              <Loading text="正在读取养成队列..." />
            </SmoothPanel>
          ) : queueError ? (
            <TrainingLoadError
              title="养成队列加载失败"
              description={queueError}
              onRetry={() => void loadQueue(true)}
            />
          ) : queue.length === 0 ? (
            <SmoothPanel className="training-queue-empty" surfaceClassName="px-4 py-6">
              <EmptyState
                compact
                icon={<ClipboardList size={20} strokeWidth={1.8} />}
                title="养成队列还是空的"
                description="从干员列表添加目标后，这里会显示后续顺序"
              />
            </SmoothPanel>
          ) : (
            <Card smoothCorners className="training-queue-card !p-0">
              <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
                <h3 className="text-sm font-bold text-primary"><CjkText>后续队列</CjkText></h3>
                <span className="text-xs text-tertiary">{keepNumberWithUnit(`${upcomingQueue.length} 个待处理`)}</span>
              </div>
              {upcomingQueue.length === 0 ? (
                <div className="px-4 py-5 text-sm text-secondary">当前只有一个养成目标。</div>
              ) : (
                <div className="divide-y divide-[var(--app-border)]">
                  {upcomingQueue.map((item, index) => (
                    <div
                      key={item.operatorId}
                      className="px-4 py-3 transition-colors hover:bg-[var(--app-surface-muted)]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-xs font-semibold surface-soft text-secondary">
                          #{index + 2}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <TruncatedText as="h3" className="text-sm font-bold text-primary" tooltip={item.operator.name} triggerClassName="flex-1 min-w-0">
                              {item.operator.name}
                            </TruncatedText>
                            <span className="rounded-full px-2 py-0.5 text-xs font-bold brand-chip">
                              {item.operator.rarity}★
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full surface-soft">
                            <motion.div
                              className="h-full rounded-full bg-[var(--app-accent)]"
                              initial={shouldReduceMotion ? false : { width: 0 }}
                              animate={{ width: `${item.progress}%` }}
                              transition={{ duration: shouldReduceMotion ? 0 : 0.6, ease: 'easeOut' }}
                            />
                          </div>
                        </div>
                        <span className="w-9 text-right text-xs font-semibold brand-text">{item.progress}%</span>
                        <IconButton
                          onClick={() => handleRemoveFromQueue(item.operatorId)}
                          disabled={queueMutationPending}
                          variant="ghost"
                          size="sm"
                          title={pendingOperatorIds.has(item.operatorId) ? '正在移除' : '移除'}
                          aria-label={pendingOperatorIds.has(item.operatorId) ? `正在移除${item.operator.name}` : `移除${item.operator.name}`}
                          className="text-[var(--app-danger-text)]"
                          icon={
                            pendingOperatorIds.has(item.operatorId) ? (
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                            ) : (
                              <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-4">
          {!plan ? (
            <SmoothPanel className="training-plan-empty" surfaceClassName="px-4 py-6">
              <EmptyState
                compact
                icon={<Sparkles size={20} strokeWidth={1.8} />}
                title="还没有刷取计划"
                description="添加养成目标后生成计划，即可查看今日推荐关卡"
              />
            </SmoothPanel>
          ) : (
            <>
              <Card smoothCorners className="training-plan-summary-card !p-0">
                <div className="px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase brand-text">今日流程</div>
                      <h3 className="mt-1 text-lg font-semibold text-primary"><CjkText>{planFocusName}</CjkText></h3>
                      <div className="mt-1 text-sm leading-6 text-secondary">
                        {keepNumberWithUnit(`可刷 ${openStageCount} 个关卡 · 预计 ${todayRunCount} 次 · 完整计划约 ${plan.totalSanity || 0} 理智`)}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Button
                        onClick={handleApplyPlan}
                        disabled={loading || openStageCount === 0}
                        loading={loading}
                        loadingText="应用中"
                        variant="success"
                        size="md"
                        icon={<Check size={15} strokeWidth={2.2} aria-hidden="true" />}
                      >
                        加入今日流程
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>

              <Card smoothCorners className="training-stage-preview-card !p-0">
                <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
                  <h3 className="text-base font-semibold text-primary"><CjkText>今日推荐刷图</CjkText></h3>
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold brand-chip">
                    {keepNumberWithUnit(`${previewStages.length} 个优先`)}
                  </span>
                </div>
                {previewStages.length > 0 ? (
                  <div className="divide-y divide-[var(--app-border)]">
                    {previewStages.map((stage, idx) => (
                      <div key={`${stage.stage}-${idx}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--app-surface-muted)]">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-xs font-semibold surface-soft text-secondary">
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-primary">{stage.stage}</div>
                            <TruncatedText
                              as="div"
                              className="mt-1 text-sm text-secondary"
                              tooltip={stage.materials?.slice(0, 2).map(mat => `${mat.name}×${mat.count}`).join('、') || '今日可直接推进'}
                            >
                              {stage.materials?.slice(0, 2).map(mat => `${mat.name}×${mat.count}`).join('、') || '今日可直接推进'}
                            </TruncatedText>
                          </div>
                        </div>
                        <div className="flex-shrink-0 rounded-full px-2.5 py-1 text-sm font-bold brand-chip">×{stage.totalTimes || 0}</div>
                      </div>
                    ))}
                    {hiddenStageCount > 0 && (
                      <div className="px-4 py-3 text-sm text-secondary">
                        {keepNumberWithUnit(`还有 ${hiddenStageCount} 个关卡，展开详情查看完整列表。`)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-4 py-6 text-sm text-secondary">今天没有可直接推进的养成关卡。</div>
                )}
              </Card>

              <SmoothPanel className="training-plan-details-panel">
                <details className="w-full p-4">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary marker:text-tertiary">查看材料、未开放关卡和计算详情</summary>
                  <div className="mt-5 space-y-5">
                  {plan.warnings && plan.warnings.length > 0 && (
                    <div className="rounded-2xl p-4 status-warning">
                      <h4 className="text-sm font-semibold mb-2"><CjkText>注意事项</CjkText></h4>
                      <ul className="space-y-1 text-sm">
                        {plan.warnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.closedStages && plan.closedStages.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-primary"><CjkText>今日未开放</CjkText></h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {plan.closedStages.map((stage, idx) => (
                          <div key={`${stage.stage}-${idx}`} className="rounded-xl px-3 py-2.5 surface-soft">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-bold text-primary">{stage.stage}</div>
                                <div className="mt-1 text-xs text-tertiary">
                                  {stage.materials?.slice(0, 2).map(mat => `${mat.name}×${mat.count}`).join('、') || '等待开放后再推进'}
                                </div>
                              </div>
                              <div className="text-xs font-semibold text-[var(--app-danger-text)]">未开放</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.materialHierarchy && plan.materialHierarchy.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-primary"><CjkText>材料缺口</CjkText></h3>
                      <MaterialGapList materials={plan.materialHierarchy} limit={8} emptyText="计划内材料已集齐" />
                    </div>
                  )}

                  {plan.materialHierarchy && plan.materialHierarchy.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-primary"><CjkText>材料需求</CjkText></h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plan.materialHierarchy.map((hierarchy, index) => (
                          <MaterialHierarchyNode key={`${hierarchy.id}-${index}`} node={hierarchy} />
                        ))}
                      </div>
                    </div>
                  )}

                  {plan.stages && plan.stages.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-primary"><CjkText>完整关卡列表</CjkText></h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {plan.stages.map((stage, idx) => (
                          <div
                            key={`${stage.stage}-${idx}`}
                            className="relative overflow-hidden rounded-xl p-4 surface-soft"
                          >
                            <div className="relative">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                                    stage.isOpen !== false
                                      ? 'brand-chip'
                                      : 'status-danger'
                                  }`}>
                                    {stage.stage}
                                  </div>
                                  {stage.isOpen === false && <div className="text-xs font-medium text-[var(--app-danger-text)]">未开放</div>}
                                </div>
                                <div className="rounded-full px-3 py-1.5 text-sm font-semibold brand-chip">×{stage.totalTimes || 0}</div>
                              </div>
                              {stage.materials && stage.materials.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {stage.materials.map((mat, matIdx) => (
                                    <div key={matIdx} className="rounded-full px-3 py-1.5 text-xs font-medium surface-panel text-secondary">
                                      {mat.name} ×{mat.count}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>
                </details>
              </SmoothPanel>
            </>
          )}
        </div>
          </aside>
        </div>
        )}

        {trainingMode === 'mastery' && <MasteryTrainingWorkspace />}
      </div>
      {recentlyRemoved && createPortal(
        <div
          className="fixed bottom-24 left-1/2 z-[90] flex min-h-11 w-[min(92vw,28rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-[var(--app-border-strong)] bg-[var(--app-surface-solid)] px-4 py-3 text-sm shadow-lg"
          role="status"
          aria-live="polite"
        >
          <TruncatedText
            className="min-w-0 text-primary"
            tooltip={`已移除 ${recentlyRemoved.item.operator.name}`}
            triggerClassName="flex-1 min-w-0"
          >
            已移除 {recentlyRemoved.item.operator.name}
          </TruncatedText>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleUndoRemove}
            disabled={queueMutationPending}
            className="shrink-0"
          >
            撤销
          </Button>
        </div>,
        document.body
      )}

    </div>
  );
}
