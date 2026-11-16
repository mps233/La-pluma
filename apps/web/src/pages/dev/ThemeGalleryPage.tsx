import { PageShell } from '@/shared/components'
import {
  ThemeGalleryCurrentTheme,
  ThemeGalleryDialogs,
  ThemeGalleryGlobalSurfaces,
  ThemeGalleryOverlays,
} from '@/features/theme-gallery'

export default function ThemeGalleryPage() {
  return (
    <PageShell pageKind="gallery">
      <ThemeGalleryCurrentTheme />
      <ThemeGalleryGlobalSurfaces />
      <ThemeGalleryDialogs />
      <ThemeGalleryOverlays />
    </PageShell>
  )
}
