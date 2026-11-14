import { Cable, Search } from 'lucide-react'
import { Button } from '@/shared/components'
import { useSettingsDeviceConnection } from '../hooks/useSettingsDeviceConnection'
import type { DiscoveredDevice } from '../model/deviceConnection'

export interface DeviceConnectionPanelProps {
  /** 点击时取最新草稿，而不是面板挂载时的副本。 */
  readonly adbPath: string
  readonly address: string
  /** 选择设备会更新 connection 草稿，先清掉连接表单的旧保存/读取反馈。 */
  readonly onSelectDeviceStart: () => void
  /** 首次读取被采纳前不写入草稿，选择设备入口保持禁用。 */
  readonly disabled?: boolean
}

export default function DeviceConnectionPanel({
  adbPath,
  address,
  onSelectDeviceStart,
  disabled = false,
}: DeviceConnectionPanelProps) {
  const {
    discovery: deviceDiscovery,
    test: connectionTest,
    discover: discoverDevices,
    testConnection,
    selectDevice: selectDiscoveredDevice,
  } = useSettingsDeviceConnection()
  const discoveredDevices = deviceDiscovery.devices
  const discoveryMessage = deviceDiscovery.message
  const hasSearchedDevices = deviceDiscovery.searched
  const discoveringDevices = deviceDiscovery.phase === 'running'
  const testingConnection = connectionTest.phase === 'running'
  const connectionFeedback = connectionTest.message
    ? { success: connectionTest.success, message: connectionTest.message }
    : null

  const handleUseDiscoveredDevice = (device: DiscoveredDevice) => {
    onSelectDeviceStart()
    selectDiscoveredDevice(device)
  }

  return (
    <section className="surface-soft rounded-xl p-4" aria-label="模拟器查找与连接测试">
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-lg brand-text">
            <Cable size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">模拟器连接</h3>
            <p className="mt-1 text-xs leading-5 text-tertiary">查找本机模拟器，或测试当前连接地址。</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={discoveringDevices}
            loadingText="查找中"
            disabled={disabled}
            onClick={() => void discoverDevices(adbPath)}
            className="flex-1 sm:flex-none"
            icon={<Search size={16} aria-hidden="true" />}
          >
            查找模拟器
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={testingConnection}
            loadingText="测试中"
            disabled={disabled}
            onClick={() => void testConnection(adbPath, address)}
            className="flex-1 sm:flex-none"
            icon={<Cable size={16} aria-hidden="true" />}
          >
            测试连接
          </Button>
        </div>
      </div>

      {discoveryMessage && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">{discoveryMessage}</p>
      )}

      {discoveredDevices.length > 0 && (
        <div className="config-device-list mt-3 divide-y divide-border overflow-hidden rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--border)]">
          {discoveredDevices.map(device => {
            const selectable = device.state === 'device' || device.state === 'candidate'
            const stateLabel = device.state === 'device'
              ? '已连接'
              : device.state === 'candidate'
                ? '可尝试连接'
                : device.state === 'offline'
                  ? '设备离线'
                  : device.state === 'unauthorized'
                    ? '等待授权'
                    : '状态未知'
            return (
              <button
                key={`${device.source}-${device.address}`}
                type="button"
                disabled={disabled || !selectable || testingConnection}
                onClick={() => void handleUseDiscoveredDevice(device)}
                className="flex min-h-12 w-full items-center justify-between gap-3.5 px-3 py-2.5 text-left transition-colors hover:bg-primary-soft focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{device.address}</span>
                  <span className="mt-0.5 block truncate text-xs text-tertiary">{device.details || (device.source === 'adb' ? 'ADB 已识别设备' : device.source === 'emulator-adb' ? '模拟器内置 ADB' : '本机端口')}</span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{stateLabel}</span>
              </button>
            )
          })}
        </div>
      )}

      {hasSearchedDevices && !discoveredDevices.length && (
        <p className="mt-3 text-xs leading-5 text-tertiary">未找到已连接设备。启动模拟器后重新查找，或手动填写连接地址。</p>
      )}

      {connectionFeedback && (
        <div className={`mt-3 rounded-lg px-3 py-2.5 text-xs ${connectionFeedback.success ? 'status-success' : 'status-danger'}`} role={connectionFeedback.success ? 'status' : 'alert'}>
          {connectionFeedback.message}
        </div>
      )}
    </section>
  )
}
