import {
  ThemeGalleryCurrentTheme,
  ThemeGalleryDialogs,
  ThemeGalleryGlobalSurfaces,
  ThemeGalleryOverlays,
} from '@/features/theme-gallery'

export default function ThemeGalleryPage() {
  return (
    <div className="app-page app-stack-section">
      <ThemeGalleryCurrentTheme />
      <ThemeGalleryGlobalSurfaces />
      <ThemeGalleryDialogs />
      <ThemeGalleryOverlays />
    </div>
  )
}
