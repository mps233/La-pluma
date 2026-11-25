import { useEffect, useId, useRef } from 'react'
import { Gauge, LoaderCircle, Package, Plug, RotateCw, Server, SlidersHorizontal, Smartphone, Unplug } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Field, FieldGroup, FieldLabel, FieldTitle } from '@/shared/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Slider } from '@/shared/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { DialogBody, DialogFrame } from '@/shared/components'
import { dismissNotice, notify, PREVIEW_QUALITY_NOTICE_ID } from '@/shared/notifications'
import { fpsOptions, maxSizeToShortSide, qualityPresets, type QualitySelection } from '../constants'
import { resolveQualitySelection, usePreviewStore } from '../store/previewStore'
import type { PreviewLiveStatus } from '../model/previewStatus'
import type { usePreviewSession } from '../hooks/usePreviewSession'
import type { usePreviewInfrastructureView } from '../hooks/usePreviewInfrastructureView'

interface PreviewSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: ReturnType<typeof usePreviewSession>
  infrastructure: ReturnType<typeof usePreviewInfrastructureView>
}

const maxSizeItems = [640, 960, 1280, 1600, 1920].map(size => ({
  value: String(size),
  label: `${size}px`,
}))

const signalingStatusLabels: Record<PreviewLiveStatus, string> = {
  idle: '未连接',
  connecting: '连接中',
  signaling: '信令中',
  waiting_offer: '等待画面',
  connecting_webrtc: '建立 WebRTC',
  connected: '已连接',
  disconnected: '已断开',
  error: '连接失败',
}

function formatStatistic(value: number | null | undefined, unit: string) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--'
  return `${value} ${unit}`
}

export function PreviewSettingsDialog({
  open,
  onOpenChange,
  session,
  infrastructure,
}: PreviewSettingsDialogProps) {
  const baseId = useId().replace(/:/g, '')
  const connectionHeadingId = `${baseId}-connection`
  const qualityHeadingId = `${baseId}-quality`
  const detailsHeadingId = `${baseId}-details`
  const maxSizeId = `${baseId}-max-size`
  const quality = usePreviewStore(state => state.quality)
  const customFps = usePreviewStore(state => state.customFps)
  const customMaxSize = usePreviewStore(state => state.customMaxSize)
  const customBitrateMbps = usePreviewStore(state => state.customBitrateMbps)
  const setQuality = usePreviewStore(state => state.setQuality)
  const setCustomFps = usePreviewStore(state => state.setCustomFps)
  const setCustomMaxSize = usePreviewStore(state => state.setCustomMaxSize)
  const setCustomBitrateMbps = usePreviewStore(state => state.setCustomBitrateMbps)
  const qualityDirtyRef = useRef(false)
  const active = resolveQualitySelection({ quality, customFps, customMaxSize, customBitrateMbps })

  useEffect(() => {
    if (open) qualityDirtyRef.current = false
  }, [open])

  useEffect(() => {
    if (session.status === 'connected') dismissNotice(PREVIEW_QUALITY_NOTICE_ID)
  }, [session.status])

  const {
    automationAvailable,
    automationUnavailableMessage,
    infrastructureStatus,
    infrastructureLoading,
    infrastructureError,
    onRefreshInfrastructure,
    onInstall,
    onToggleServer,
    onToggleAgent,
  } = infrastructure
  const infrastructureKnown = infrastructureStatus !== null && infrastructureStatus !== undefined
  const infrastructureBusy = infrastructureLoading !== null && infrastructureLoading !== undefined
  const previewBusy = infrastructureLoading === 'preview' || session.isConnecting
  const canDisconnect = session.mode !== 'off' || previewBusy || !['idle', 'disconnected'].includes(session.status)
  const serviceActions = [
    {
      key: 'server',
      label: infrastructureStatus?.serverRunning ? '停止服务' : '启动服务',
      icon: Server,
      onClick: onToggleServer,
      disabled: !infrastructureKnown || infrastructureBusy || (!infrastructureStatus?.serverRunning && !automationAvailable),
      allowWhenUnavailable: !!infrastructureStatus?.serverRunning,
      loading: infrastructureLoading === 'server',
    },
    {
      key: 'agent',
      label: infrastructureStatus?.agentRunning ? '停止 Agent' : '连接 Agent',
      icon: Smartphone,
      onClick: onToggleAgent,
      disabled: !infrastructureKnown || infrastructureBusy || (infrastructureStatus?.agentRunning ? false : !infrastructureStatus?.serverRunning || !automationAvailable),
      allowWhenUnavailable: !!infrastructureStatus?.agentRunning,
      loading: infrastructureLoading === 'agent',
    },
  ] as const

  const stats: [string, string | number][] = [
    ['信令', signalingStatusLabels[session.status]],
    ['ICE', session.stats?.iceState || '--'],
    ['视频', session.stats?.videoLive ? '实时' : '--'],
    ['分辨率', session.stats?.width ? `${session.stats.width}×${session.stats.height}` : '--'],
    ['FPS', session.stats?.fps ?? '--'],
    ['码率', formatStatistic(session.stats?.bitrate, 'kbps')],
    ['网络 RTT', formatStatistic(session.stats?.rtt, 'ms')],
    ['触控', session.inputReady ? '就绪' : session.status === 'connected' ? '等待触控信息' : '--'],
  ]

  const reconnect = () => {
    if (!automationAvailable) return
    session.connect()
    qualityDirtyRef.current = false
    dismissNotice(PREVIEW_QUALITY_NOTICE_ID)
  }

  const notifyQualityChange = () => {
    if (qualityDirtyRef.current) return
    qualityDirtyRef.current = true
    const appliesAfterReconnect = session.mode === 'live'
    notify(
      appliesAfterReconnect ? '画质已修改，重连后生效' : '画质已修改，下次连接实时预览时生效',
      'info',
      {
        id: PREVIEW_QUALITY_NOTICE_ID,
        ...(appliesAfterReconnect
          ? { duration: 8000, action: { label: '重连', onClick: reconnect } }
          : {}),
      },
    )
  }

  const applyQuality = (next: QualitySelection) => {
    setQuality(next)
    notifyQualityChange()
  }

  const disconnectLabel = previewBusy ? '取消启动' : '断开'
  const installLabel = infrastructureLoading === 'install'
    ? '安装中'
    : infrastructureStatus?.built ? '重装组件' : '安装组件'
  const reconnectHint = !automationAvailable
    ? automationUnavailableMessage
    : session.mode !== 'live' ? '切换到实时预览后可重连' : '重连预览'

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="预览设置"
      size="lg"
      closeClassName="min-h-11 min-w-11"
    >
      <DialogBody className="flex flex-col gap-4">
        <section aria-labelledby={connectionHeadingId} className="flex flex-col gap-3">
          <h3 id={connectionHeadingId} className="flex items-center gap-2 text-sm font-medium">
            <Plug className="size-4 text-muted-foreground" aria-hidden="true" />
            连接与服务
          </h3>
          {infrastructureError && (
            <Alert variant="destructive">
              <AlertTitle>预览服务状态异常</AlertTitle>
              <AlertDescription>{infrastructureError}</AlertDescription>
              <div className="mt-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  onClick={onRefreshInfrastructure}
                >
                  刷新状态
                </Button>
              </div>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-2">
            {serviceActions.map(action => {
              const Icon = action.icon
              return (
                <Tooltip key={action.key}>
                  <TooltipTrigger render={<span className="flex" />}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-h-11 w-full"
                      onClick={() => {
                        if (!action.onClick || (!automationAvailable && !action.allowWhenUnavailable)) return
                        void action.onClick()
                      }}
                      disabled={action.disabled}
                    >
                      <Icon data-icon="inline-start" aria-hidden="true" />
                      {action.loading ? '处理中' : action.label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {action.disabled && !automationAvailable ? automationUnavailableMessage : action.label}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Tooltip>
              <TooltipTrigger render={<span className="flex" />}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 w-full"
                  onClick={session.disconnect}
                  disabled={!canDisconnect}
                >
                  <Unplug data-icon="inline-start" aria-hidden="true" />
                  {disconnectLabel}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{disconnectLabel}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<span className="flex" />}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 w-full"
                  onClick={reconnect}
                  disabled={session.mode !== 'live' || !automationAvailable || infrastructureBusy}
                  aria-busy={infrastructureLoading === 'preview' || undefined}
                >
                  {infrastructureLoading === 'preview'
                    ? <><LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />加载中···</>
                    : <><RotateCw data-icon="inline-start" aria-hidden="true" />重连预览</>}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{reconnectHint}</TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger render={<span className="flex" />}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 w-full"
                onClick={() => { void onInstall?.() }}
                disabled={!automationAvailable || infrastructureBusy || !infrastructureKnown}
              >
                <Package data-icon="inline-start" aria-hidden="true" />
                {installLabel}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {!automationAvailable ? automationUnavailableMessage : installLabel}
            </TooltipContent>
          </Tooltip>
        </section>

        <section aria-labelledby={qualityHeadingId} className="flex flex-col gap-3">
          <h3 id={qualityHeadingId} className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
            画质设置
          </h3>

          <FieldGroup className="gap-3">
            <Field>
              <FieldTitle>画质预设</FieldTitle>
              <ToggleGroup
                aria-label="画质预设"
                value={[quality]}
                onValueChange={(next) => {
                  const nextQuality = next[0] as QualitySelection | undefined
                  if (nextQuality && nextQuality !== quality) applyQuality(nextQuality)
                }}
                multiple={false}
                spacing={1}
                className="grid w-full grid-cols-2"
              >
                {Object.entries(qualityPresets).map(([key, preset]) => (
                  <ToggleGroupItem
                    key={key}
                    value={key}
                    aria-label={`${preset.label}画质`}
                    title={`${maxSizeToShortSide(preset.maxSize)}p · ${preset.fps} FPS · 码率 ${preset.bitrateMbps} Mbps`}
                    className="h-auto min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left aria-pressed:bg-primary-soft aria-pressed:text-primary-strong"
                  >
                    <span className="text-xs font-medium">{preset.label}</span>
                    <small className="text-xs font-normal text-muted-foreground">{maxSizeToShortSide(preset.maxSize)}p · {preset.fps} FPS · {preset.bitrateMbps}M</small>
                  </ToggleGroupItem>
                ))}
                <ToggleGroupItem
                  value="custom"
                  aria-label="自定义画质"
                  className="h-auto min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg px-2 py-1.5 text-left aria-pressed:bg-primary-soft aria-pressed:text-primary-strong"
                >
                  <span className="text-xs font-medium">自定义</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldTitle>帧率</FieldTitle>
              <ToggleGroup
                aria-label="视频帧率"
                value={[String(active.fps)]}
                onValueChange={(next) => {
                  const fps = Number(next[0])
                  if (!Number.isFinite(fps) || fps === active.fps) return
                  setCustomFps(fps)
                  notifyQualityChange()
                }}
                multiple={false}
                spacing={1}
                className="grid w-full grid-cols-4"
              >
                {fpsOptions.map(fps => (
                  <ToggleGroupItem
                    key={fps}
                    value={String(fps)}
                    aria-label={`${fps} FPS`}
                    className="min-h-11 rounded-lg text-xs aria-pressed:bg-primary-soft aria-pressed:text-primary-strong"
                  >
                    {fps}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>

            <Field orientation="horizontal" className="items-center justify-between gap-3">
              <FieldLabel htmlFor={maxSizeId}>最长边</FieldLabel>
              <Select
                items={maxSizeItems}
                value={String(active.maxSize)}
                onValueChange={(next, details) => {
                  if (!next || details.reason === 'none' || Number(next) === active.maxSize) return
                  setCustomMaxSize(Number(next))
                  notifyQualityChange()
                }}
              >
                <SelectTrigger id={maxSizeId} className="min-h-11 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {maxSizeItems.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldTitle>
                  <Gauge className="size-3.5" aria-hidden="true" />码率
                </FieldTitle>
                <output className="inline-flex items-baseline gap-1 text-xs text-muted-foreground">
                  <strong className="text-sm font-bold text-foreground">{active.bitrateMbps}</strong>
                  <span>Mbps</span>
                </output>
              </div>
              <Slider
                min={1}
                max={32}
                step={0.5}
                value={[active.bitrateMbps]}
                thumbAriaLabel="视频码率"
                onValueChange={(next) => {
                  const bitrate = Array.isArray(next) ? next[0] : next
                  if (bitrate === undefined || bitrate === active.bitrateMbps) return
                  setCustomBitrateMbps(bitrate)
                  notifyQualityChange()
                }}
                className="py-3"
              />
            </Field>
          </FieldGroup>
        </section>

        <section aria-labelledby={detailsHeadingId} className="flex flex-col gap-3">
          <h3 id={detailsHeadingId} className="flex items-center gap-2 text-sm font-medium">
            <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
            连接详情
          </h3>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1 text-xs sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-md px-2 py-1.5">
                <div className="text-muted-foreground">{label}</div>
                <div className="truncate font-medium text-foreground">{value}</div>
              </div>
            ))}
          </div>
        </section>
      </DialogBody>
    </DialogFrame>
  )
}
