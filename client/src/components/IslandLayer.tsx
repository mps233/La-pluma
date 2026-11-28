import { Island, IslandProvider } from '@/lib/island'
import RunIsland from './RunIsland'
import MaaUpdateIsland from './MaaUpdateIsland'
import MasteryIsland from './MasteryIsland'
import SanityBatteryIsland from './SanityBatteryIsland'

/**
 * The whole island subsystem lives behind one lazy boundary: the provider,
 * the live surface, the four activity adapters, the islandcn visuals, and
 * their icon package. Keeping it together means a single async chunk instead
 * of leaking pieces back into the entry graph.
 */
export default function IslandLayer() {
  return (
    <IslandProvider>
      <div className="la-pluma-island-layer">
        <Island placement="container" label="La Pluma 活动" />
        <RunIsland />
        <MaaUpdateIsland />
        <MasteryIsland />
        <SanityBatteryIsland />
      </div>
    </IslandProvider>
  )
}
