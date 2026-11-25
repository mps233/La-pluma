import { usePreviewSessionContext } from './previewSessionContext'

export function usePreviewInfrastructureView() {
  const { infrastructure } = usePreviewSessionContext()
  return infrastructure.view
}
