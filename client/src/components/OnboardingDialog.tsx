import type { ReactNode } from 'react'
import { ArrowRight, Bot, Download, KeyRound, Monitor } from 'lucide-react'
import { Button, CjkText, Modal } from './common'
import { isDesktopRuntime } from '@/desktop/bridge'
import { useUIStore } from '@/state'
import { notifyAuthRequired } from '@/utils/accessToken'
import { requestPwaInstall } from '@/utils/pwaInstallPrompt'

interface OnboardingDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface OnboardingStep {
  id: string
  icon: ReactNode
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

export default function OnboardingDialog({ isOpen, onClose }: OnboardingDialogProps) {
  const setActiveTab = useUIStore(state => state.setActiveTab)
  const desktop = isDesktopRuntime()

  const openTokenDialog = () => {
    onClose()
    notifyAuthRequired()
  }

  const openAutomation = () => {
    onClose()
    setActiveTab('automation')
  }

  const openInstallPrompt = () => {
    onClose()
    requestPwaInstall()
  }

  const steps: OnboardingStep[] = [
    ...(desktop
      ? []
      : [{
          id: 'token',
          icon: <KeyRound className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />,
          title: '填写访问令牌',
          description: '如果服务要求访问令牌，填写后即可加载数据；之后可在「配置」里修改。',
          actionLabel: '填写令牌',
          onAction: openTokenDialog,
        }]),
    {
      id: 'automation',
      icon: <Bot className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />,
      title: '创建第一个自动化任务',
      description: '在「自动化任务」里编排日常流程，让重复操作自动完成。',
      actionLabel: '打开自动化任务',
      onAction: openAutomation,
    },
    desktop
      ? {
          id: 'desktop',
          icon: <Monitor className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />,
          title: '使用桌面端',
          description: '你正在桌面端运行 La Pluma，全部功能都已经就绪。',
          actionLabel: '开始使用',
          onAction: onClose,
        }
      : {
          id: 'install',
          icon: <Download className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />,
          title: '安装为应用',
          description: '安装到主屏幕后，可以像普通应用一样随时打开。',
          actionLabel: '安装应用',
          onAction: openInstallPrompt,
        },
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="新手引导"
      size="md"
      footer={(
        <Button variant="primary" onClick={onClose}>
          开始使用
        </Button>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-secondary">
          第一次使用 La Pluma？按下面的步骤准备好控制台。关闭后可以从控制台右上角随时重新打开。
        </p>
        <ol className="space-y-2.5">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="surface-soft flex flex-col gap-4 rounded-[var(--app-radius-lg)] p-3 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-start gap-4">
                <span
                  className="icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--app-radius-md)] brand-text"
                  aria-hidden="true"
                >
                  {step.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[11px] font-semibold tabular-nums text-tertiary">第 {index + 1} 步</span>
                    <span className="text-sm font-semibold text-primary">
                      <CjkText>{step.title}</CjkText>
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-secondary">{step.description}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full shrink-0 sm:w-auto"
                onClick={step.onAction}
                icon={<ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
              >
                {step.actionLabel}
              </Button>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}
