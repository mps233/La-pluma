import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/ui/button'
import { notify, SETTINGS_CONNECTION_TEST_NOTICE_ID } from '@/shared/notifications'
import DeviceConnectionDialog from './DeviceConnectionDialog'
import { useSettingsDeviceConnection } from '../hooks/useSettingsDeviceConnection'
import type { ConnectionTestState, DiscoveredDevice } from '../model/deviceConnection'

export interface DeviceConnectionPanelProps {
  /** 点击时取最新草稿，而不是面板挂载时的副本。 */
  readonly adbPath: string
  readonly address: string
  /** 首次读取被采纳前不写入草稿，选择设备入口保持禁用。 */
  readonly disabled?: boolean
}

export default function DeviceConnectionPanel({
  adbPath,
  address,
  disabled = false,
}: DeviceConnectionPanelProps) {
  const {
    discovery: deviceDiscovery,
    test: connectionTest,
    discover: discoverDevices,
    cancelDiscovery,
    testConnection,
    selectDevice: selectDiscoveredDevice,
  } = useSettingsDeviceConnection()
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const lastNotifiedTestRef = useRef<ConnectionTestState | null>(null)
  const discoveringDevices = deviceDiscovery.phase === 'running'
  const testingConnection = connectionTest.phase === 'running'

  useEffect(() => {
    if (connectionTest.phase !== 'succeeded' && connectionTest.phase !== 'failed') return
    if (lastNotifiedTestRef.current === connectionTest) return
    lastNotifiedTestRef.current = connectionTest
    if (!connectionTest.message) return
    notify(
      connectionTest.message,
      connectionTest.success ? 'success' : 'error',
      { id: SETTINGS_CONNECTION_TEST_NOTICE_ID },
    )
  }, [connectionTest])

  const openDiscovery = () => {
    setDiscoveryOpen(true)
    discoverDevices(adbPath)
  }

  const closeDiscovery = () => {
    cancelDiscovery()
    setDiscoveryOpen(false)
  }

  const handleUseDiscoveredDevice = (device: DiscoveredDevice) => {
    selectDiscoveredDevice(device)
    closeDiscovery()
  }

  return (
    <section className="min-w-0" aria-label="设备查找与连接测试">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-medium whitespace-nowrap text-foreground">设备连接</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || discoveringDevices}
            aria-busy={discoveringDevices || undefined}
            onClick={openDiscovery}
            className="shrink-0"
          >
            查找设备
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || testingConnection}
            aria-busy={testingConnection || undefined}
            onClick={() => void testConnection(adbPath, address)}
            className="shrink-0"
          >
            测试连接
          </Button>
        </div>
      </div>

      <DeviceConnectionDialog
        open={discoveryOpen}
        onOpenChange={(open) => {
          if (!open) closeDiscovery()
        }}
        discovery={deviceDiscovery}
        disabled={disabled}
        testing={testingConnection}
        onDiscover={() => discoverDevices(adbPath)}
        onSelectDevice={handleUseDiscoveredDevice}
      />
    </section>
  )
}
