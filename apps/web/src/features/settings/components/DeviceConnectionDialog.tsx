import { LoaderCircle, Search } from 'lucide-react'
import { DialogBody, DialogFrame, DialogFrameFooter, EmptyState, InlineAlert } from '@/shared/components'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/shared/ui/item'
import type { DeviceDiscoveryState, DiscoveredDevice } from '../model/deviceConnection'

export interface DeviceConnectionDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly discovery: DeviceDiscoveryState
  readonly disabled?: boolean
  readonly testing?: boolean
  readonly onDiscover: () => void
  readonly onSelectDevice: (device: DiscoveredDevice) => void
}

const deviceStateLabel = (device: DiscoveredDevice): string => {
  switch (device.state) {
    case 'device':
      return '已连接'
    case 'candidate':
      return '可尝试连接'
    case 'offline':
      return '设备离线'
    case 'unauthorized':
      return '等待授权'
    default:
      return '状态未知'
  }
}

const deviceStateClass = (device: DiscoveredDevice): string => {
  switch (device.state) {
    case 'device':
      return 'status-success'
    case 'candidate':
      return 'status-info'
    case 'offline':
    case 'unauthorized':
      return 'status-warning'
    default:
      return 'text-muted-foreground'
  }
}

export default function DeviceConnectionDialog({
  open,
  onOpenChange,
  discovery,
  disabled = false,
  testing = false,
  onDiscover,
  onSelectDevice,
}: DeviceConnectionDialogProps) {
  const devices = discovery.devices
  const running = discovery.phase === 'running'
  const failed = discovery.phase === 'failed'
  const cancelled = discovery.phase === 'cancelled'
  const empty = discovery.searched && !devices.length && !failed && !cancelled

  const statusMessage = running
    ? '正在查找设备...'
    : cancelled
      ? '查找已取消'
      : !failed && devices.length
        ? discovery.message
        : null

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="查找设备"
    >
      <DialogBody className="flex flex-col gap-3">
        {statusMessage && (
          <p role="status" className="text-xs text-muted-foreground">{statusMessage}</p>
        )}

        {failed && (
          <InlineAlert tone="error">
            {discovery.message ?? discovery.error ?? '查找设备失败'}
          </InlineAlert>
        )}

        {devices.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            {devices.map(device => {
              const selectable = device.state === 'device' || device.state === 'candidate'
              return (
                <Item
                  key={`${device.source}-${device.address}`}
                  render={(
                    <button
                      type="button"
                      disabled={disabled || !selectable || testing}
                      onClick={() => onSelectDevice(device)}
                    />
                  )}
                  className="min-h-12 rounded-none border-0 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle className="block w-full truncate">{device.address}</ItemTitle>
                    <ItemDescription className="line-clamp-1 text-xs">
                      {device.details || (device.source === 'adb'
                        ? 'ADB 已识别设备'
                        : device.source === 'emulator-adb'
                          ? '模拟器内置 ADB'
                          : '本机端口')}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="ghost" className={deviceStateClass(device)}>
                      {deviceStateLabel(device)}
                    </Badge>
                  </ItemActions>
                </Item>
              )
            })}
          </div>
        )}

        {empty && (
          <EmptyState
            compact
            icon={<Search className="h-5 w-5" aria-hidden="true" />}
            title="未找到已连接设备"
            description={discovery.message ?? undefined}
          />
        )}
      </DialogBody>

      <DialogFrameFooter>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || running}
          aria-busy={running || undefined}
          onClick={onDiscover}
        >
          {running
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />查找中</>
            : '重新查找'}
        </Button>
      </DialogFrameFooter>
    </DialogFrame>
  )
}
