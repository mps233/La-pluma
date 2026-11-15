import {
  ThemeGalleryCurrentTheme,
  ThemeGalleryDialogs,
  ThemeGalleryGlobalSurfaces,
  ThemeGalleryOverlays,
} from '@/features/theme-gallery'
import { PageHeader } from '@/shared/components'

export default function ThemeGalleryPage() {
  return (
    <div className="app-page app-stack-section">
      <PageHeader
        title="主题画廊"
        subtitle="主题迁移对照画布：核对当前主题状态与既有全局表面的表现。"
      />
      <ThemeGalleryCurrentTheme />
      <ThemeGalleryGlobalSurfaces />
      <ThemeGalleryDialogs />
      <ThemeGalleryOverlays />
    </div>
  )
}
