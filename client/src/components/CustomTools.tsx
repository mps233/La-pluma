import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Crown,
  Eraser,
  FlaskConical,
  Paintbrush,
  Play,
  ShoppingBag,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { maaApi } from '../services/api'
import { useStatusStore } from '../store/statusStore'
import { Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Loading, PageHeader, Switch } from './common'
import FloatingStatusIndicator from './FloatingStatusIndicator'

interface CustomTool {
  id: string
  name: string
  description: string
  requiresParams: boolean
  paramsKey: string | null
}

const GRID_SIZE = 24
const PALETTE = Array.from({ length: 40 }, (_, index) => `hsl(${Math.round(index * 9)} 68% 55%)`)
const TOOL_ICONS: Record<string, ReactNode> = {
  'pixel-paint': <Paintbrush size={18} aria-hidden="true" />,
  'auto-raise-potential': <Sparkles size={18} aria-hidden="true" />,
  'material-synthesis': <FlaskConical size={18} aria-hidden="true" />,
  'cursed-relic': <Crown size={18} aria-hidden="true" />,
  'event-shop-blacklist': <ShoppingBag size={18} aria-hidden="true" />,
}

function cellKey(x: number, y: number) {
  return `${x}:${y}`
}

function groupCells(cells: Record<string, number>) {
  const groups = new Map<number, Array<[number, number]>>()
  for (const [key, color] of Object.entries(cells)) {
    const [rawX, rawY] = key.split(':')
    const x = Number(rawX)
    const y = Number(rawY)
    const points = groups.get(color) || []
    points.push([x, y])
    groups.set(color, points)
  }
  return [...groups.entries()].map(([color, points]) => ({ color, points }))
}

export default function CustomTools() {
  const { setMessage } = useStatusStore()
  const [tools, setTools] = useState<CustomTool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('pixel-paint')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const [color, setColor] = useState(0)
  const [cells, setCells] = useState<Record<string, number>>({})
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [swipe, setSwipe] = useState(true)
  const [gridDelay, setGridDelay] = useState(0)
  const [useNormalToken, setUseNormalToken] = useState(false)
  const [blacklistText, setBlacklistText] = useState('')
  const isPainting = useRef(false)

  const loadTools = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await maaApi.listCustomTools()
      const nextTools = Array.isArray(result.data?.tools) ? result.data.tools as CustomTool[] : []
      setTools(nextTools)
      if (nextTools.length > 0 && !nextTools.some(tool => tool.id === selectedId)) {
        setSelectedId(nextTools[0]!.id)
      }
    } catch (loadError) {
      setError((loadError as Error).message || '工具列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void loadTools()
  }, [loadTools])

  useEffect(() => {
    const stopPainting = () => { isPainting.current = false }
    window.addEventListener('pointerup', stopPainting)
    window.addEventListener('pointercancel', stopPainting)
    return () => {
      window.removeEventListener('pointerup', stopPainting)
      window.removeEventListener('pointercancel', stopPainting)
    }
  }, [])

  const paintCell = (x: number, y: number) => {
    setCells(current => ({ ...current, [cellKey(x, y)]: color }))
  }

  const selectedTool = tools.find(tool => tool.id === selectedId) || null

  const buildParams = (tool: CustomTool): Record<string, unknown> | null => {
    if (tool.id === 'pixel-paint') {
      const groups = groupCells(cells)
      if (groups.length === 0) {
        setMessage('请先在 24×24 点阵上选择颜色并点击格子', 'error')
        return null
      }
      return {
        groups,
        swipe,
        grid_delay: Number(gridDelay) || 0
      }
    }
    if (tool.id === 'auto-raise-potential') {
      return { use_normal_token: useNormalToken }
    }
    if (tool.id === 'event-shop-blacklist') {
      return {
        blacklist: blacklistText.split(/\n+/).map(item => item.trim()).filter(Boolean)
      }
    }
    return {}
  }

  const handleRun = async (tool: CustomTool, dryRun = false) => {
    const params = buildParams(tool)
    if (params === null) return

    setRunningId(tool.id)
    setLastResult(null)
    try {
      const result = await maaApi.runCustomTool(tool.id, params, { dryRun })
      if (result.success) {
        setMessage(dryRun ? '参数检查通过' : `${tool.name}执行完成`, 'success')
        if (dryRun) setLastResult(JSON.stringify(result.data, null, 2))
      } else {
        setMessage(maaApi.getErrorMessage(result), 'error')
      }
    } catch (runError) {
      setMessage(`执行失败：${(runError as Error).message}`, 'error')
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="app-page ios-workspace-page">
      <PageHeader
        title="小工具"
        subtitle="按需运行不进入每日流程的 MAA 小工具"
        mobileLayout="inline"
        actions={<FloatingStatusIndicator />}
      />

      <section className="app-stack-section" aria-label="工具列表">
        {loading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Loading text="正在读取工具列表" />
          </div>
        ) : error ? (
          <EmptyState
            icon={<Wrench size={26} aria-hidden="true" />}
            title="工具列表暂不可用"
            description={error}
            action={<Button variant="secondary" onClick={() => void loadTools()}>重试</Button>}
          />
        ) : tools.length === 0 ? (
          <EmptyState
            icon={<Wrench size={26} aria-hidden="true" />}
            title="暂无可用工具"
            description="当前 MAA 版本没有返回可用的小工具。"
          />
        ) : (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tools.map(tool => {
              const selected = tool.id === selectedId
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => { setSelectedId(tool.id); setLastResult(null) }}
                  aria-pressed={selected}
                  className={`app-card surface-panel flex min-h-24 min-w-0 flex-col items-start gap-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${selected ? 'ring-1 ring-[var(--app-accent)]' : 'hover:bg-[var(--app-surface-muted)]'}`}
                >
                  <span className="icon-well flex h-9 w-9 items-center justify-center rounded-[var(--app-radius-md)] brand-text">
                    {TOOL_ICONS[tool.id] || <Wrench size={18} aria-hidden="true" />}
                  </span>
                  <span className="text-sm font-semibold text-primary">{tool.name}</span>
                  <span className="text-xs leading-5 text-tertiary">{tool.description}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {selectedTool && (
        <Card smoothCorners className="min-w-0">
          <div className="app-card-header flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 brand-text">
                {TOOL_ICONS[selectedTool.id] || <Wrench size={18} aria-hidden="true" />}
              </span>
              <h3 className="app-section-title min-w-0 break-words text-primary">{selectedTool.name}</h3>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Button
                variant="secondary"
                size="sm"
                loading={runningId === selectedTool.id}
                loadingText="检查中"
                onClick={() => void handleRun(selectedTool, true)}
              >
                检查参数
              </Button>
              <Button
                size="sm"
                loading={runningId === selectedTool.id}
                loadingText="执行中"
                onClick={() => void handleRun(selectedTool)}
                icon={<Play size={15} aria-hidden="true" />}
              >
                立即执行
              </Button>
            </div>
          </div>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-secondary">{selectedTool.description}</p>

            {selectedTool.id === 'pixel-paint' && (
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-secondary">色板</span>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="色板序号">
                      {PALETTE.map((background, index) => (
                        <button
                          key={index}
                          type="button"
                          aria-label={`色板 ${index}`}
                          aria-pressed={color === index}
                          title={`色板 ${index}`}
                          onClick={() => setColor(index)}
                          className={`h-6 w-6 rounded-md border transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${color === index ? 'scale-110 border-[var(--app-accent)]' : 'border-[var(--app-border)]'}`}
                          style={{ background }}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-tertiary">当前 {color}</span>
                  </div>

                  <div
                    className="grid w-full max-w-[26rem] touch-none select-none gap-px overflow-hidden rounded-[var(--app-radius-md)] border border-[var(--app-border)]"
                    style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 1fr))` }}
                    role="grid"
                    aria-label="24×24 点阵"
                  >
                    {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                      const x = index % GRID_SIZE
                      const y = Math.floor(index / GRID_SIZE)
                      const painted = cells[cellKey(x, y)]
                      return (
                        <button
                          key={index}
                          type="button"
                          aria-label={`格子 ${x},${y}`}
                          title={`${x},${y}`}
                          onPointerDown={() => { isPainting.current = true; paintCell(x, y) }}
                          onPointerEnter={() => { if (isPainting.current) paintCell(x, y) }}
                          className="aspect-square min-h-0 border-0 p-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--app-accent)]"
                          style={{
                            background: painted === undefined ? 'var(--app-surface-muted)' : PALETTE[painted]
                          }}
                        />
                      )
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Eraser size={15} aria-hidden="true" />}
                      onClick={() => setConfirmClearOpen(true)}
                      disabled={Object.keys(cells).length === 0}
                    >
                      清空点阵
                    </Button>
                    <span className="text-xs text-tertiary">已填 {Object.keys(cells).length} 格</span>
                  </div>
                </div>

                <div className="min-w-0 space-y-3">
                  <Switch
                    label="同色同行拖动填色"
                    checked={swipe}
                    onChange={setSwipe}
                  />
                  <Input
                    label="每格额外等待（毫秒）"
                    type="number"
                    value={gridDelay}
                    onChange={value => setGridDelay(Number(value) || 0)}
                    hint="一般保持 0；触控不稳定时可适当增加"
                  />
                  <p className="text-xs leading-5 text-tertiary">
                    颜色使用游戏色板序号 0–39，坐标以左上角为原点，范围 0–23。
                  </p>
                </div>
              </div>
            )}

            {selectedTool.id === 'auto-raise-potential' && (
              <Switch
                label="中坚信物不足时使用普通信物继续"
                checked={useNormalToken}
                onChange={setUseNormalToken}
              />
            )}

            {selectedTool.id === 'event-shop-blacklist' && (
              <div className="min-w-0">
                <label className="mb-1.5 block text-sm font-medium text-primary" htmlFor="custom-tool-blacklist">
                  不购买的商品名
                </label>
                <textarea
                  id="custom-tool-blacklist"
                  className="app-input control-surface min-h-28 w-full resize-y px-3 py-2 text-sm"
                  value={blacklistText}
                  onChange={event => setBlacklistText(event.target.value)}
                  placeholder="每行一个商品名，例如：固源岩"
                />
                <p className="mt-1.5 text-xs leading-5 text-tertiary">识别到的商品名包含任一条目时跳过该商品，最多 100 项。</p>
              </div>
            )}

            {(selectedTool.id === 'material-synthesis' || selectedTool.id === 'cursed-relic') && (
              <p className="surface-soft rounded-[var(--app-radius-md)] p-3 text-xs leading-5 text-tertiary">
                该工具无需额外参数，执行后会直接在游戏中开始对应流程。
              </p>
            )}

            {lastResult && (
              <pre className="max-h-56 overflow-auto rounded-[var(--app-radius-md)] bg-[var(--app-surface-muted)] p-3 text-xs leading-5 text-secondary">
                {lastResult}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        isOpen={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => setCells({})}
        title="清空点阵？"
        message={`将清除当前已填的 ${Object.keys(cells).length} 格点阵，此操作无法撤销。`}
        confirmText="清空"
        variant="danger"
      />
    </div>
  )
}
