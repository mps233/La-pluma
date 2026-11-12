/**
 * Domain identity icons.
 *
 * The task workspaces render these as the glyph inside their own identity
 * well, so each component stays a bare SVG. Domain names are kept here so
 * the automation and combat task definitions read as product concepts
 * rather than a list of third-party icon names.
 */

import {
  Building2,
  CircleDollarSign,
  FileText,
  Gift,
  Package,
  Play,
  Power,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Swords,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'

interface IconProps {
  className?: string
}

function createIcon(Icon: LucideIcon, defaultClassName = 'h-4 w-4') {
  function DomainIcon({ className = defaultClassName }: IconProps) {
    return <Icon className={className} strokeWidth={1.9} aria-hidden="true" />
  }

  DomainIcon.displayName = Icon.displayName ? `${Icon.displayName}Icon` : 'DomainIcon'
  return DomainIcon
}

const Icons = {
  Play: createIcon(Play),
  Sword: createIcon(Swords),
  Building: createIcon(Building2),
  Users: createIcon(Users),
  Cash: createIcon(CircleDollarSign),
  Gift: createIcon(Gift),
  Stop: createIcon(Power),
  Package: createIcon(Package),
  Document: createIcon(FileText),
  Shield: createIcon(ShieldCheck),
  Puzzle: createIcon(Puzzle),
  TrendingUp: createIcon(TrendingUp, 'h-5 w-5'),
  RefreshCw: createIcon(RefreshCw, 'h-5 w-5'),
}

export default Icons
