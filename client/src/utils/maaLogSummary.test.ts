import { describe, expect, it } from 'vitest'
import { summarizeMaaCliMessage, summarizeMaaCliSummaryBlock } from './maaLogSummary'

describe('maaLogSummary', () => {
  it('turns a maa-cli Summary block into a readable report', () => {
    const block = [
      'Summary',
      '----------------------------------------',
      '[Fight] 12:00:00 - 12:03:00 (3m 0s) Completed',
      'Fight 1-7 2 times, used 1 medicine, drops:',
      'total drops: Orirock ×2, LMD ×1000',
    ].join('\n')

    const result = summarizeMaaCliSummaryBlock(block)
    expect(result?.message).toContain('任务总结：作战')
    expect(result?.message).toContain('完成')
    expect(result?.message).toContain('使用 1 瓶理智药')
    expect(result?.message).toContain('合计掉落：Orirock ×2、LMD ×1000')
  })

  it('does not treat a stopped report as a failure', () => {
    const result = summarizeMaaCliSummaryBlock('Summary\n---\n[Fight] 12:00:00 - 12:01:00 Stopped')
    expect(result?.level).toBe('WARN')
    expect(result?.message).toContain('已停止')
  })

  it('rewrites interrupted commands and unrecognized summaries', () => {
    expect(summarizeMaaCliMessage('Error: Interrupted by user!')).toEqual({
      message: '任务已按请求停止',
      level: 'WARN',
    })
    expect(summarizeMaaCliSummaryBlock('not a report')).toBeNull()
  })
})
