import { Package } from 'lucide-react'
import { getItemIconUrl, useItemIconCacheVersion } from '@/features/game-data'
import { Badge } from '@/shared/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import type { MaterialNode } from '../types'

export function ResourceIcon({ id }: { id?: string | number }) {
  const itemIconVersion = useItemIconCacheVersion()
  return <span className="training-resource-icon"><Package size={18} aria-hidden="true" />{id && <img src={getItemIconUrl(id, itemIconVersion)} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} />}</span>
}

/** 当前目标的缺口表格：只展示仍有缺口的材料，顺序由调用方决定。 */
export function MaterialTable({ materials }: { materials: MaterialNode[] }) {
  return (
    <Table aria-label="材料筹备明细">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col" className="h-9 w-full pl-4 text-xs font-normal text-muted-foreground">材料</TableHead>
          <TableHead scope="col" className="h-9 text-right text-xs font-normal text-muted-foreground">拥有</TableHead>
          <TableHead scope="col" className="h-9 text-right text-xs font-normal text-muted-foreground">需要</TableHead>
          <TableHead scope="col" className="h-9 pr-4 text-right text-xs font-normal text-muted-foreground">缺口</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {materials.map(material => (
          <TableRow key={material.id} className="hover:bg-transparent">
            <TableCell className="h-14 py-0 pl-4 whitespace-normal">
              <span className="flex min-w-0 items-center gap-2">
                <ResourceIcon id={material.iconId} />
                <span className="min-w-0 wrap-anywhere">{material.name}</span>
              </span>
            </TableCell>
            <TableCell className="h-14 text-right tabular-nums">{material.have}</TableCell>
            <TableCell className="h-14 text-right tabular-nums">{material.needed}</TableCell>
            <TableCell className={`h-14 pr-4 text-right tabular-nums ${material.stillNeeded > 0 ? 'brand-text font-semibold' : 'text-muted-foreground'}`}>
              {material.stillNeeded > 0
                ? material.stillNeeded
                : <Badge variant="outline" className="border-transparent text-muted-foreground">已齐</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function MaterialTree({ nodes }: { nodes: MaterialNode[] }) {
  return <ul className="training-material-tree">{nodes.map(node => <li key={node.id}>
    <div><ResourceIcon id={node.iconId} /><span className="min-w-0 flex-1">{node.name}</span><span className="text-muted-foreground tabular-nums">{node.have} / {node.needed}</span><Badge variant="outline" className={node.stillNeeded > 0 ? 'border-transparent brand-text' : 'border-transparent text-muted-foreground'}>{node.stillNeeded > 0 ? `缺 ${node.stillNeeded}` : '已齐'}</Badge></div>
    {node.children && node.children.length > 0 && <MaterialTree nodes={node.children} />}
  </li>)}</ul>
}
