import { useRef, type ChangeEvent, type ClipboardEvent } from 'react'
import { Compass, ListPlus, LoaderCircle, Upload, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import type { CopilotPreviewMode } from '../model/copilotPreview'
import { COPILOT_DISCOVERY_DIALOG_ID } from './combatPanelTypes'
import type { CombatCopilotFileImportProjection } from './combatPanelTypes'

const PREVIEW_MODE_OPTIONS: ReadonlyArray<{ value: CopilotPreviewMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'single', label: '单个作业' },
  { value: 'set', label: '作业集' },
]

interface CombatCopilotInputPanelProps {
  input: string
  isLoading: boolean
  isAddingToQueue?: boolean
  previewMode: CopilotPreviewMode
  fileImport?: CombatCopilotFileImportProjection
  onInputChange: (value: string) => void
  onPreviewModeChange: (mode: CopilotPreviewMode) => void
  onPreview: () => void
  onAddToQueue?: () => void
  onOpenDiscovery: () => void
}

export default function CombatCopilotInputPanel({
  input,
  isLoading,
  isAddingToQueue = false,
  previewMode,
  fileImport,
  onInputChange,
  onPreviewModeChange,
  onPreview,
  onAddToQueue,
  onOpenDiscovery,
}: CombatCopilotInputPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uriInputRef = useRef<HTMLInputElement>(null)

  const handleClear = () => {
    onInputChange('')
    uriInputRef.current?.focus()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) fileImport?.onImport(file)
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!fileImport) return
    const clipboard = event.clipboardData
    const files = Array.from(clipboard.files)
    if (files.length === 0) {
      for (const item of Array.from(clipboard.items)) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    const file = files.find(candidate => candidate.type === 'application/json'
      || candidate.name.toLowerCase().endsWith('.json'))
    if (!file) return
    event.preventDefault()
    fileImport.onImport(file)
  }

  return (
    <div className="combat-copilot-input">
      <div className="combat-copilot-input-row">
        <label htmlFor="combat-copilot-uri" className="sr-only">作业链接，或粘贴 JSON 作业文件</label>
        <label htmlFor="combat-copilot-preview-mode" className="sr-only">识别方式</label>
        <div className="combat-copilot-uri-field">
          <input
            id="combat-copilot-uri"
            ref={uriInputRef}
            type="text"
            name="maa-copilot-uri"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            placeholder="prts://1234、prts://s1234、作业站链接或粘贴 JSON 文件"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={handlePaste}
            className="combat-copilot-uri-input"
          />
          {input !== '' && (
            <Button
              size="icon"
              variant="ghost"
              title="清除作业链接"
              aria-label="清除作业链接"
              disabled={isLoading || isAddingToQueue}
              onClick={handleClear}
              className="combat-copilot-clear-button"
            >
              <X size={15} aria-hidden="true" />
            </Button>
          )}
          <div className="combat-copilot-uri-trailing">
            {fileImport && (
              <>
                <label htmlFor="combat-copilot-file" className="sr-only">导入 JSON 作业文件</label>
                <input
                  id="combat-copilot-file"
                  ref={fileInputRef}
                  type="file"
                  name="maa-copilot-file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="sr-only"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  title="导入 JSON 作业文件"
                  aria-label="导入 JSON 作业文件"
                  aria-busy={fileImport.isImporting || undefined}
                  disabled={fileImport.isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  className="combat-copilot-import-button"
                >
                  {fileImport.isImporting
                    ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                    : <Upload size={16} aria-hidden="true" />}
                </Button>
              </>
            )}
            <select
              id="combat-copilot-preview-mode"
              name="maa-copilot-preview-mode"
              value={previewMode}
              onChange={(e) => onPreviewModeChange(e.target.value as CopilotPreviewMode)}
              className="combat-copilot-mode-select"
            >
              {PREVIEW_MODE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <Button
          onClick={onPreview}
          aria-haspopup="dialog"
          disabled={isLoading || !input.trim()}
          aria-busy={isLoading || undefined}
          variant="secondary"
          className="shrink-0 px-3"
        >
          {isLoading
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />加载中...</>
            : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                预览
              </>
            )}
        </Button>
        {onAddToQueue && (
          <Button
            onClick={onAddToQueue}
            disabled={isAddingToQueue || isLoading || !input.trim()}
            aria-busy={isAddingToQueue || undefined}
            variant="secondary"
            className="shrink-0 px-3"
          >
            {isAddingToQueue
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />加入中</>
              : (
                <>
                  <ListPlus size={15} aria-hidden="true" />
                  加入队列
                </>
              )}
          </Button>
        )}
        <Button
          onClick={onOpenDiscovery}
          aria-haspopup="dialog"
          aria-controls={COPILOT_DISCOVERY_DIALOG_ID}
          variant="secondary"
          className="shrink-0 px-3"
        >
          <Compass size={15} aria-hidden="true" />
          发现
        </Button>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 min-w-11 px-2 text-xs text-primary-strong"
              />
            }
          >
            说明
          </PopoverTrigger>
          <PopoverContent
            aria-label="作业输入说明"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="w-[min(18rem,calc(100vw-3rem))] text-xs text-muted-foreground"
          >
            <p className="m-0 leading-normal">• 在 <a href="https://prts.plus/" target="_blank" rel="noopener noreferrer" className="brand-text hover:underline">prts.plus</a> 获取作业链接</p>
            <p className="m-0 leading-normal">• 单作业：<code className="combat-copilot-code">prts://1234</code>；作业集：<code className="combat-copilot-code">prts://s1234</code></p>
            <p className="m-0 leading-normal">• 作业站链接会自动识别，也可直接粘贴或导入本地 JSON 文件</p>
            <p className="m-0 leading-normal">• 识别方式可强制按单个作业或作业集读取，默认按链接判断</p>
            <p className="m-0 leading-normal">• 点击“发现”可按关键词、关卡和干员搜索作业站作业</p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
