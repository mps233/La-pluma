import { usePreviewSessionContext } from './previewSessionContext'

export function usePreviewSnapshot(available = true) {
  const { snapshot } = usePreviewSessionContext()
  return available ? snapshot : { image: null, error: null, retry: snapshot.retry }
}
