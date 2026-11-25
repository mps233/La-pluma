// 设备命令的取消跟随页面/Activity 生命周期，而不是面板可见性：设备面板随 section
// 显示/隐藏，若在它的 cleanup 中取消，切到其它 section 就会中断在途查找/测试。

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  settingsDeviceConnectionOwner,
  type ConnectionTestState,
  type DeviceConnectionOwner,
  type DeviceDiscoveryState,
  type DiscoveredDevice,
} from '../model/deviceConnection'

export interface UseSettingsDeviceConnectionResult {
  readonly discovery: DeviceDiscoveryState
  readonly test: ConnectionTestState
  readonly discover: (adbPath: string) => void
  readonly cancelDiscovery: () => void
  readonly testConnection: (adbPath: string, address: string) => void
  readonly selectDevice: (device: DiscoveredDevice) => void
  readonly clearTestFeedback: () => void
}

export function useSettingsDeviceConnection(
  owner: DeviceConnectionOwner = settingsDeviceConnectionOwner,
): UseSettingsDeviceConnectionResult {
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)

  const discover = useCallback((adbPath: string) => {
    void owner.discover(adbPath)
  }, [owner])

  const cancelDiscovery = useCallback(() => {
    owner.cancelDiscovery()
  }, [owner])

  const testConnection = useCallback((adbPath: string, address: string) => {
    void owner.test(adbPath, address)
  }, [owner])

  const selectDevice = useCallback((device: DiscoveredDevice) => {
    void owner.selectDiscoveredDevice(device)
  }, [owner])

  const clearTestFeedback = useCallback(() => {
    owner.clearTestFeedback()
  }, [owner])

  return {
    discovery: state.discovery,
    test: state.test,
    discover,
    cancelDiscovery,
    testConnection,
    selectDevice,
    clearTestFeedback,
  }
}

/**
 * 地址编辑等与设备面板无关的输入需要清除旧测试反馈；这里只暴露稳定动作，
 * 不订阅命令状态，避免把设备状态带进连接表单的渲染边界。
 */
export function useClearConnectionTestFeedback(
  owner: DeviceConnectionOwner = settingsDeviceConnectionOwner,
): () => void {
  return useCallback(() => {
    owner.clearTestFeedback()
  }, [owner])
}

/**
 * Activity 隐藏或页面真正卸载时结束设备命令的本地等待；section 切换不触发。
 */
export function useDeviceConnectionActivityCleanup(
  owner: DeviceConnectionOwner = settingsDeviceConnectionOwner,
): void {
  useEffect(() => () => owner.cancelAll(), [owner])
}
