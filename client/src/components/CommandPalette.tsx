import CommandPalette from 'react-command-palette'
import type { Command } from 'react-command-palette'
import '../styles/components/command-palette.css'

export interface CommandPaletteProps {
  open: boolean
  commands: Command[]
  onClose: () => void
}

const commandPaletteTheme = {
  modal: 'la-pluma-command-modal',
  overlay: 'la-pluma-command-overlay',
  container: 'la-pluma-command-container',
  input: 'la-pluma-command-input',
  inputFocused: 'is-focused',
  suggestionsContainer: 'la-pluma-command-suggestions',
  suggestionsContainerOpen: 'is-open',
  suggestionsList: 'la-pluma-command-list',
  suggestion: 'la-pluma-command-item',
  suggestionHighlighted: 'is-highlighted',
}

/**
 * Cmd/Ctrl+K destination switcher. The palette is controlled by Layout so the
 * same commands can be opened from the sidebar trigger or the keyboard.
 */
export default function AppCommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  return (
    <CommandPalette
      commands={commands}
      open={open}
      onRequestClose={onClose}
      closeOnSelect
      resetInputOnOpen
      display="modal"
      placeholder="搜索工作区..."
      hotKeys={[]}
      trigger={null}
      theme={commandPaletteTheme}
      maxDisplayed={12}
      highlightFirstSuggestion
      options={{
        key: 'name',
        keys: ['name'],
        threshold: -10000,
        limit: 12,
        allowTypo: true,
      }}
      onAfterOpen={() => {
        document.querySelector<HTMLElement>('[role="dialog"]')?.setAttribute('aria-label', '命令面板')
        document.querySelector<HTMLInputElement>('.la-pluma-command-input')?.setAttribute('aria-label', '搜索工作区')
      }}
    />
  )
}
