import { describe, expect, it } from 'vitest'
import { keepNumberWithUnit, NBSP } from './typography'

describe('keepNumberWithUnit', () => {
  it('joins a number and its Chinese unit', () => {
    expect(keepNumberWithUnit('剩余 16 天')).toBe(`剩余 16${NBSP}天`)
    expect(keepNumberWithUnit('第 1 次探索')).toBe(`第 1${NBSP}次探索`)
    expect(keepNumberWithUnit('可刷 3 个关卡 · 预计 6 次')).toBe(
      `可刷 3${NBSP}个关卡 · 预计 6${NBSP}次`,
    )
  })

  it('joins percentages and degrees', () => {
    expect(keepNumberWithUnit('88 %')).toBe(`88${NBSP}%`)
    expect(keepNumberWithUnit('36 °C')).toBe(`36${NBSP}°C`)
  })

  it('joins common Latin units without touching product names', () => {
    expect(keepNumberWithUnit('60 FPS')).toBe(`60${NBSP}FPS`)
    expect(keepNumberWithUnit('12.34 KB')).toBe(`12.34${NBSP}KB`)
    expect(keepNumberWithUnit('8M')).toBe('8M')
    expect(keepNumberWithUnit('1 MAA CLI')).toBe('1 MAA CLI')
  })

  it('leaves text without a space or without a unit alone', () => {
    expect(keepNumberWithUnit('1项')).toBe('1项')
    expect(keepNumberWithUnit('5.4G / 5.8G')).toBe('5.4G / 5.8G')
    expect(keepNumberWithUnit('MAA CLI')).toBe('MAA CLI')
    expect(keepNumberWithUnit('2026-11-05 14:32')).toBe('2026-11-05 14:32')
  })
})
