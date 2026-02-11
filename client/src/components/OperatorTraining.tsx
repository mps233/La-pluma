import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { getOperatorList, getTrainingQueue, addToTrainingQueue, removeFromTrainingQueue, updateTrainingSettings, generateTrainingPlan, applyTrainingPlan } from '../services/api'
import { PageHeader, Button, Checkbox, IconButton, StatusIndicator } from './common'
import type {
  MaterialHierarchyNodeProps,
  TrainingOperator,
  TrainingQueueItem,
  TrainingSettings,
  TrainingPlan,
  TrainingFilters,
  TrainingActiveTab,
  TrainingPlanMode,
  TrainingOpenMenu
} from '@/types/components'

// 材料层级节点组件
function MaterialHierarchyNode({ node, depth = 0 }: MaterialHierarchyNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  
  // 根据深度选择不同的颜色
  const getColorByDepth = (d: number): string => {
    const colors = [
      'from-amber-500 to-yellow-500', // 顶层：琥珀色→黄色
      'from-blue-500 to-cyan-500',   // 第二层：蓝色→青色
      'from-green-500 to-emerald-500', // 第三层：绿色→翡翠绿
      'from-orange-500 to-amber-500'  // 第四层：橙色→琥珀色
    ];
    return colors[Math.min(d, colors.length - 1)]!;
  };
  
  const getBgColorByDepth = (d: number): string => {
    const colors = [
      'from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 border-amber-200 dark:border-amber-500/20',
      'from-blue-50 to-cyan-50 dark:from-blue-900/10 dark:to-cyan-900/10 border-blue-200 dark:border-blue-500/20',
      'from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 border-green-200 dark:border-green-500/20',
      'from-orange-50 to-amber-50 dark:from-orange-900/10 dark:to-amber-900/10 border-orange-200 dark:border-orange-500/20'
    ];
    return colors[Math.min(d, colors.length - 1)]!;
  };
  
  // 只有顶层材料才返回完整的卡片结构
  if (depth === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="p-4 rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 hover:shadow-xl transition-all space-y-3"
      >
        {/* 顶层材料 */}
        <div className={`p-3 rounded-xl border bg-gradient-to-br ${getBgColorByDepth(depth)}`}>
          <div className="flex items-center gap-3">
            {/* 材料图标 */}
            <div className="flex-shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
              {node.iconId ? (
                <img
                  src={`/api/maa/item-icon/${node.iconId}`}
                  alt={node.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 图标加载失败时，隐藏图片并显示默认图标
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.default-icon')) {
                      const iconDiv = document.createElement('div');
                      iconDiv.className = `default-icon w-10 h-10 rounded-lg bg-gradient-to-br ${getColorByDepth(depth)} flex items-center justify-center`;
                      iconDiv.innerHTML = hasChildren 
                        ? '<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>'
                        : '<svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                      parent.appendChild(iconDiv);
                    }
                  }}
                />
              ) : (
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${getColorByDepth(depth)} flex items-center justify-center`}>
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
                  <span className="px-2 py-0.5 bg-white dark:bg-gray-800 rounded-full text-xs font-medium text-orange-600 dark:text-orange-400">
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
                  <div className={`px-3 py-1 rounded-lg text-center ${
                    hasChildren 
                      ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white' 
                      : 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                  }`}>
                    <div className="text-xs font-bold">{hasChildren ? '还需合成' : '还需刷'} {node.stillNeeded}</div>
                  </div>
                ) : (
                  <div className="px-3 py-1 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white text-center">
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
    <div className={`p-2.5 rounded-lg border bg-gradient-to-br ${getBgColorByDepth(depth)}`}>
      <div className="flex items-center gap-2">
        {/* 材料图标 */}
        <div className="flex-shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
          {node.iconId ? (
            <img
              src={`/api/maa/item-icon/${node.iconId}`}
              alt={node.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                // 图标加载失败，显示默认图标
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.fallback-icon')) {
                  const fallbackDiv = document.createElement('div');
                  fallbackDiv.className = `fallback-icon w-7 h-7 rounded-lg bg-gradient-to-br ${getColorByDepth(depth)} flex items-center justify-center`;
                  fallbackDiv.innerHTML = hasChildren 
                    ? '<svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>'
                    : '<svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>';
                  parent.appendChild(fallbackDiv);
                }
              }}
            />
          ) : (
            <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${getColorByDepth(depth)} flex items-center justify-center`}>
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
              <span className={`px-2 py-0.5 rounded font-bold text-xs ${
                hasChildren 
                  ? 'bg-orange-500 text-white' 
                  : 'bg-blue-500 text-white'
              }`}>
                -{node.stillNeeded}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-green-500 text-white font-bold text-xs">✓</span>
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

export default function OperatorTraining() {
  const [statusMessage, setStatusMessage] = useState<string>('')
  
  // 辅助函数：使用 statusMessage 显示消息
  const showSuccess = async (msg: string) => {
    setStatusMessage(`✓ ${msg}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setStatusMessage('')
  }
  const showError = async (msg: string) => {
    setStatusMessage(`❌ ${msg}`)
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
  const [activeTab, setActiveTab] = useState<TrainingActiveTab>('operators');
  const [filters, setFilters] = useState<TrainingFilters>({
    rarity: '',
    profession: '',
    needsElite2: true
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [planMode, setPlanMode] = useState<TrainingPlanMode>('current');
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [openMenu, setOpenMenu] = useState<TrainingOpenMenu>(null);

  // 加载干员列表
  useEffect(() => {
    loadOperators();
  }, [filters]);

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
        setOperators(response.data.operators || response.data || []);
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
      }
    } catch (error) {
      // 静默失败
    }
  };

  const handleAddToQueue = async (operator: TrainingOperator) => {
    try {
      setLoading(true);
      setStatusMessage('正在添加干员...');
      
      const response = await addToTrainingQueue({
        operatorId: operator.id,
      } as any);
      
      if (response.success) {
        await loadQueue();
        setStatusMessage(`✓ ${operator.name} 添加成功！`);
        await new Promise(resolve => setTimeout(resolve, 800));
        
        setStatusMessage('正在生成刷取计划...');
        
        // 自动生成刷取计划（仅当前干员）
        try {
          const planResponse = await generateTrainingPlan({ mode: 'current' });
          if (planResponse.success && planResponse.data) {
            const generatedPlan = planResponse.data;
            setPlan(generatedPlan);
            
            setStatusMessage('正在应用到作战任务...');
            
            // 自动应用到作战任务
            try {
              const applyResponse = await applyTrainingPlan({
                plan: generatedPlan,
              } as any);
              if (applyResponse.success) {
                setStatusMessage('✓ 刷取计划已应用到作战任务！');
                await new Promise(resolve => setTimeout(resolve, 1500));
                setStatusMessage('');
              } else {
                setStatusMessage('❌ 应用失败');
                await new Promise(resolve => setTimeout(resolve, 2000));
                setStatusMessage('');
              }
            } catch (applyError) {
              setStatusMessage('❌ 应用失败');
              await new Promise(resolve => setTimeout(resolve, 2000));
              setStatusMessage('');
            }
          } else {
            setStatusMessage('❌ 生成计划失败');
            await new Promise(resolve => setTimeout(resolve, 2000));
            setStatusMessage('');
          }
        } catch (planError) {
          setStatusMessage('❌ 生成计划失败');
          await new Promise(resolve => setTimeout(resolve, 2000));
          setStatusMessage('');
        }
      }
    } catch (error: any) {
      setStatusMessage('❌ 添加失败');
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
        setStatusMessage('✓ 删除成功！');
        await new Promise(resolve => setTimeout(resolve, 1500));
        setStatusMessage('');
      }
    } catch (error) {
      setStatusMessage('❌ 删除失败');
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
        setActiveTab('plan');
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
    
    try {
      setLoading(true);
      showInfo('应用中...');
      const response = await applyTrainingPlan({
        plan,
      } as any);
      
      if (response.success) {
        showSuccess('养成计划已应用到作战任务流程！');
        
        // 触发事件通知其他组件重新加载配置
        window.dispatchEvent(new CustomEvent('training-plan-applied', {
          detail: { stageCount: response.data.stageCount }
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
      const response = await updateTrainingSettings({
        ...newSettings,
        notify: newSettings.notifyOnComplete ?? false
      } as any);
      if (response.success) {
        setSettings(response.data);
      }
    } catch (error) {
      // 静默失败
    }
  };

  // 过滤干员
  const filteredOperators = operators.filter(op => {
    if (searchTerm && !op.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 页面标题 */}
        <PageHeader
          icon={
            <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          }
          title="智能养成系统"
          subtitle="自动识别未精二干员，计算材料需求，生成刷取计划"
          gradientFrom="amber-400"
          gradientVia="yellow-400"
          gradientTo="orange-400"
          actions={
            <StatusIndicator
              isActive={loading}
              activeText="加载中"
              inactiveText="就绪"
              activeColor="amber-400"
              inactiveColor="emerald-400"
              message={statusMessage}
            />
          }
        />

      {/* 标签页切换 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 border-b border-gray-200 dark:border-white/10"
      >
        <button
          onClick={() => setActiveTab('operators')}
          className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-all relative ${
            activeTab === 'operators'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span>干员列表</span>
          {activeTab === 'operators' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"
              initial={false}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('queue')}
          className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-all relative ${
            activeTab === 'queue'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span>养成队列 {queue.length > 0 && `(${queue.length})`}</span>
          {activeTab === 'queue' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"
              initial={false}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('plan')}
          className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-all relative ${
            activeTab === 'plan'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <span>刷取计划</span>
          {activeTab === 'plan' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"
              initial={false}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </button>
      </motion.div>

      {/* 干员列表标签页 */}
      {activeTab === 'operators' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* 提示信息 */}
          {!operatorsLoading && filteredOperators.length === 0 && (
            <div className="rounded-2xl p-4 border border-blue-300 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/5">
              <div className="flex items-start space-x-3">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-800 dark:text-blue-300">
                  <p className="font-medium mb-1">提示</p>
                  <p>干员列表为空？请先前往"数据统计"页面，点击"识别干员"按钮，系统会自动识别你拥有的所有干员。</p>
                </div>
              </div>
            </div>
          )}

          {/* 搜索和过滤 */}
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
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>
            
            {/* 过滤按钮组 */}
            <div className="flex gap-2">
              {/* 稀有度 */}
              <div className="relative filter-menu-container">
                <button
                  onClick={() => setOpenMenu(openMenu === 'rarity' ? null : 'rarity')}
                  className={`h-[42px] flex items-center space-x-1.5 px-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                    filters.rarity
                      ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium'
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
                className={`h-[42px] flex items-center space-x-1.5 px-3 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                  filters.needsElite2
                    ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span>仅未精二</span>
              </button>
            </div>
          </div>

          {/* 干员卡片列表 */}
          {operatorsLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
              <p className="mt-2 text-gray-600 dark:text-gray-400">加载中...</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filteredOperators.map((operator, idx) => {
                const isInQueue = queue.some(q => q.operatorId === operator.id);
                const imageLoaded = loadedImages[operator.id] || false;
                const canAdd = operator.hasMaterialData && !isInQueue;
                
                return (
                  <motion.div
                    key={operator.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.01 }}
                    className={`group relative p-3 rounded-2xl border transition-all overflow-hidden ${
                      canAdd
                        ? 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border-amber-200 dark:border-amber-500/20 hover:border-amber-400 dark:hover:border-amber-500/40 hover:shadow-lg'
                        : 'bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/20 dark:to-gray-800/20 border-gray-300 dark:border-gray-600/20'
                    }`}
                  >
                    {/* 已添加/不支持标识 */}
                    {isInQueue && (
                      <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-green-500/90 text-white text-xs font-bold rounded backdrop-blur-sm">
                        已添加
                      </div>
                    )}
                    {!operator.hasMaterialData && (
                      <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-gray-500/90 text-white text-xs font-bold rounded backdrop-blur-sm">
                        不支持
                      </div>
                    )}
                    
                    {/* 干员头像 */}
                    <div className="relative w-full aspect-square mb-2 rounded-xl overflow-hidden bg-gradient-to-br from-amber-200 via-yellow-200 to-orange-200 dark:from-amber-900/50 dark:via-yellow-900/40 dark:to-orange-900/50">
                      {operator.id ? (
                        <>
                          {/* 骨架屏 */}
                          {!imageLoaded && (
                            <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-amber-300 via-yellow-200 to-orange-300 dark:from-amber-800/60 dark:via-yellow-800/50 dark:to-orange-800/60"></div>
                          )}
                          <img
                            src={`https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/${operator.id}.png`}
                            alt={operator.name}
                            className={`w-full h-full object-cover transition-opacity duration-500 ${
                              imageLoaded ? 'opacity-100' : 'opacity-0'
                            } ${canAdd && imageLoaded ? 'group-hover:scale-110 transition-transform duration-300' : ''}`}
                            onLoad={() => setLoadedImages(prev => ({ ...prev, [operator.id]: true }))}
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
                                setLoadedImages(prev => ({ ...prev, [operator.id]: true }));
                              }
                            }}
                          />
                          {/* 不可添加时的半透明蒙版 */}
                          {!canAdd && imageLoaded && (
                            <div className="absolute inset-0 bg-white/60 dark:bg-black/40"></div>
                          )}
                        </>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400 dark:text-gray-600">
                          无头像
                        </div>
                      )}
                      {/* 稀有度标识 */}
                      {operator.rarity !== undefined && operator.rarity > 0 && (
                        <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-amber-500/90 text-white text-xs font-bold rounded backdrop-blur-sm">
                          {operator.rarity}★
                        </div>
                      )}
                    </div>
                    
                    <div className="text-center space-y-2">
                      <div className="text-sm font-bold text-gray-900 dark:text-white truncate" title={operator.name}>
                        {operator.name || '未知干员'}
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-1 text-xs">
                        {operator.currentElite !== undefined && (
                          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full whitespace-nowrap">
                            精{operator.currentElite}
                          </span>
                        )}
                        {operator.currentLevel !== undefined && (
                          <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded-full whitespace-nowrap">
                            Lv.{operator.currentLevel}
                          </span>
                        )}
                      </div>
                      
                      {/* 添加按钮 */}
                      <Button
                        onClick={() => handleAddToQueue(operator)}
                        disabled={!canAdd}
                        variant="gradient"
                        gradientFrom="amber"
                        gradientTo="yellow"
                        size="sm"
                        fullWidth
                        className="text-xs"
                      >
                        {isInQueue ? '已添加' : !operator.hasMaterialData ? '不支持' : '添加'}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {!operatorsLoading && filteredOperators.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              没有找到符合条件的干员
            </div>
          )}
        </motion.div>
      )}

      {/* 养成队列标签页 */}
      {activeTab === 'queue' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* 设置 */}
          <div className="p-6 rounded-3xl border border-amber-200 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">养成设置</h3>
              
              {/* 生成计划按钮 */}
              {queue.length > 0 && (
                <div className="flex items-center gap-3">
                  <select
                    value={planMode}
                    onChange={(e) => setPlanMode(e.target.value as TrainingPlanMode)}
                    className="px-4 py-2 border-2 border-amber-300 dark:border-amber-600 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-gray-900 dark:text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all cursor-pointer hover:border-amber-400 dark:hover:border-amber-500"
                  >
                    <option value="current">仅当前干员</option>
                    <option value="all">所有干员</option>
                  </select>
                  
                  <Button
                    onClick={handleGeneratePlan}
                    disabled={loading}
                    variant="gradient"
                    gradientFrom="amber"
                    gradientTo="yellow"
                  >
                    {loading ? '生成中...' : '生成计划'}
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Checkbox
                checked={settings.autoSwitch}
                onChange={(checked: boolean) => handleUpdateSettings({ ...settings, autoSwitch: checked })}
                label="材料集齐后自动切换到下一个干员"
                className="p-3 rounded-xl bg-amber-100/50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30"
              />
              
              <Checkbox
                checked={settings.notifyOnComplete}
                onChange={(checked: boolean) => handleUpdateSettings({ ...settings, notifyOnComplete: checked })}
                label="完成时发送通知"
                className="p-3 rounded-xl bg-amber-100/50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30"
              />
            </div>
          </div>

          {/* 队列列表 */}
          {queue.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              养成队列为空，请从干员列表中添加
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {queue.map((item, index) => (
                <motion.div
                  key={item.operatorId}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="group relative p-6 rounded-3xl border border-amber-200 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 hover:border-amber-400 dark:hover:border-amber-500/40 hover:shadow-xl transition-all overflow-hidden"
                >
                  {/* 背景装饰 */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-amber-500/5 to-yellow-500/5 rounded-full blur-3xl"></div>
                  
                  <div className="relative flex items-start gap-4">
                    {/* 序号徽章 */}
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
                        <span className="text-xl font-bold text-white">#{index + 1}</span>
                      </div>
                    </div>
                    
                    {/* 干员信息 */}
                    <div className="flex-1 min-w-0">
                      {/* 干员名称和星级 */}
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                          {item.operator.name}
                        </h3>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full text-xs font-bold">
                            {item.operator.rarity}★
                          </span>
                          <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full text-xs font-medium">
                            {item.operator.profession}
                          </span>
                        </div>
                      </div>
                      
                      {/* 进度条 */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="text-gray-600 dark:text-gray-400 font-medium">材料进度</span>
                          <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-yellow-600 dark:from-amber-400 dark:to-yellow-400">
                            {item.progress}%
                          </span>
                        </div>
                        <div className="relative w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <motion.div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 via-yellow-500 to-orange-500 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${item.progress}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent"></div>
                          </motion.div>
                        </div>
                      </div>
                      
                      {/* 材料列表 */}
                      {item.materials && item.materials.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {item.materials.slice(0, 6).map((mat) => (
                            <div 
                              key={mat.id} 
                              className="flex items-center justify-between p-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30"
                            >
                              <span className="text-xs text-gray-700 dark:text-gray-300 font-medium truncate flex-1">
                                {mat.name}
                              </span>
                              <div className="flex items-center gap-1 ml-2">
                                <span className="text-xs text-gray-600 dark:text-gray-400">
                                  {mat.have}/{mat.needed}
                                </span>
                                {mat.stillNeeded > 0 && (
                                  <span className="text-xs font-semibold text-red-500 dark:text-red-400">
                                    (-{mat.stillNeeded})
                                  </span>
                                )}
                                {mat.stillNeeded === 0 && (
                                  <span className="text-xs text-green-500">✓</span>
                                )}
                              </div>
                            </div>
                          ))}
                          {item.materials.length > 6 && (
                            <div className="flex items-center justify-center p-2 rounded-xl bg-amber-100/50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30">
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                还有 {item.materials.length - 6} 种材料...
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* 完成标记 */}
                      {item.isComplete && (
                        <motion.div 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-xl shadow-lg shadow-green-500/25"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm font-semibold">材料已集齐</span>
                        </motion.div>
                      )}
                    </div>
                    
                    {/* 移除按钮 */}
                    <div className="flex-shrink-0">
                      <IconButton
                        onClick={() => handleRemoveFromQueue(item.operatorId)}
                        variant="ghost"
                        size="md"
                        title="移除"
                        className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 group-hover:shadow-lg"
                        icon={
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        }
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* 刷取计划标签页 */}
      {activeTab === 'plan' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {!plan ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              请先在养成队列中生成刷取计划
            </div>
          ) : (
            <>
              {/* 计划概览 */}
              <div className="p-6 rounded-3xl border border-amber-300 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-500/5 dark:to-yellow-500/5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 shadow-lg shadow-amber-500/25">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      养成计划概览
                    </h3>
                  </div>
                  
                  {/* 应用按钮 */}
                  <Button
                    onClick={handleApplyPlan}
                    disabled={loading || !plan.stages || plan.stages.length === 0}
                    variant="gradient"
                    gradientFrom="amber"
                    gradientTo="yellow"
                  >
                    {loading ? '应用中...' : '应用到作战任务'}
                  </Button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-2xl bg-white dark:bg-gray-900/40 border border-amber-200 dark:border-amber-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">养成干员</div>
                    </div>
                    <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-600 to-yellow-600 dark:from-amber-400 dark:to-yellow-400">
                      {plan.operators?.length || 0}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-white dark:bg-gray-900/40 border border-blue-200 dark:border-blue-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">需要材料</div>
                    </div>
                    <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400">
                      {plan.materials?.length || 0}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-white dark:bg-gray-900/40 border border-green-200 dark:border-green-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">刷取关卡</div>
                    </div>
                    <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-600 to-emerald-600 dark:from-green-400 dark:to-emerald-400">
                      {plan.stages?.length || 0}
                    </div>
                  </div>
                  <div className="p-4 rounded-2xl bg-white dark:bg-gray-900/40 border border-orange-200 dark:border-orange-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">总理智消耗</div>
                    </div>
                    <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-400 dark:to-red-400">
                      {plan.totalSanity || 0}
                    </div>
                  </div>
                </div>
              </div>

              {/* 警告信息 */}
              {plan.warnings && plan.warnings.length > 0 && (
                <div className="rounded-2xl p-4 border border-yellow-300 dark:border-yellow-500/20 bg-yellow-50 dark:bg-yellow-500/5">
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                        ⚠️ 注意事项
                      </h4>
                      <ul className="space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
                        {plan.warnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* 材料需求列表（层级显示） */}
              {plan.materialHierarchy && plan.materialHierarchy.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/25">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      材料需求
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plan.materialHierarchy.map((hierarchy, index) => (
                      <MaterialHierarchyNode key={`${hierarchy.id}-${index}`} node={hierarchy} />
                    ))}
                  </div>
                </div>
              )}

              {/* 关卡列表 */}
              {plan.stages && plan.stages.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 shadow-lg shadow-green-500/25">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      刷取关卡
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plan.stages.map((stage, idx) => (
                      <motion.div
                        key={`${stage.stage}-${idx}`}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`group relative p-5 rounded-3xl border transition-all overflow-hidden ${
                          stage.isOpen !== false
                            ? 'border-gray-200 dark:border-white/10 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900/60 dark:to-gray-800/40 hover:border-green-400 dark:hover:border-green-500/30 hover:shadow-xl'
                            : 'border-red-300 dark:border-red-500/30 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/10 dark:to-orange-900/10'
                        }`}
                      >
                        {/* 背景装饰 */}
                        <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl ${
                          stage.isOpen !== false
                            ? 'bg-gradient-to-br from-green-500/5 to-emerald-500/5' 
                            : 'bg-gradient-to-br from-red-500/5 to-orange-500/5'
                        }`}></div>
                        
                        <div className="relative">
                          {/* 关卡代号 */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`px-3 py-1.5 rounded-xl font-bold text-sm shadow-lg ${
                                stage.isOpen !== false
                                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-green-500/25'
                                  : 'bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-red-500/25'
                              }`}>
                                {stage.stage}
                              </div>
                              {stage.isOpen === false && (
                                <div className="flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs font-medium">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                  <span>未开放</span>
                                </div>
                              )}
                            </div>
                            
                            {/* 次数徽章 */}
                            <div className="flex items-center gap-2">
                              <div className="px-3 py-1.5 rounded-xl bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-500/30">
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">×</span>
                                <span className="text-sm font-bold text-blue-700 dark:text-blue-300 ml-0.5">
                                  {stage.totalTimes || 0}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          {/* 掉落材料 */}
                          {stage.materials && stage.materials.length > 0 && (
                            <div className="mb-3">
                              <div className="flex flex-wrap gap-2">
                                {stage.materials.map((mat, matIdx) => (
                                  <div 
                                    key={matIdx}
                                    className="px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-500/20 text-xs font-medium text-purple-700 dark:text-purple-300"
                                  >
                                    {mat.name} ×{mat.needed}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* 理智消耗 */}
                          <div className="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border border-orange-200 dark:border-orange-500/20">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">理智消耗</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {stage.sanityPerRun || 0} × {stage.totalTimes || 0} =
                              </span>
                              <span className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-red-600 dark:from-orange-400 dark:to-red-400">
                                {(stage.sanityPerRun || 0) * (stage.totalTimes || 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
      </div>
    </div>
  );
}
