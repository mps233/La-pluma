export const pageLoaders = {
  automation: () => import('../components/AutomationTasks'),
  combat: () => import('../components/CombatTasks'),
  roguelike: () => import('../components/RoguelikeTasks'),
  training: () => import('../components/OperatorTraining'),
  tools: () => import('../components/CustomTools'),
  logs: () => import('../components/LogViewer'),
  statistics: () => import('../components/DataStatistics'),
  config: () => import('../components/ConfigManager'),
} as const

export type PageId = keyof typeof pageLoaders

const preloadedPages = new Set<PageId>()

/**
 * Warm one route on navigation intent (hover/focus/tap). We deliberately do
 * not prefetch every route after mount: that downloads the whole app on a
 * phone before the user has shown any interest in those tabs.
 */
export function preloadPage(id: string): void {
  if (!(id in pageLoaders)) return
  const pageId = id as PageId
  if (preloadedPages.has(pageId)) return

  preloadedPages.add(pageId)
  void pageLoaders[pageId]().catch(() => {
    preloadedPages.delete(pageId)
  })
}