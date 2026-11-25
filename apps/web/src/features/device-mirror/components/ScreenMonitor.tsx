import ScrcpyDeviceView from './ScrcpyDeviceView'
import { usePreviewSessionContext } from '../hooks/previewSessionContext'

export default function ScreenMonitor() {
  const { infrastructure } = usePreviewSessionContext()
  return <ScrcpyDeviceView infrastructure={infrastructure.view} />
}
