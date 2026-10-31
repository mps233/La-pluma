const CALLBACK_MARKER = 'Assistant::append_callback | ';

export function parseMaaCallbackPayloads(logOutput) {
  const events = [];

  for (const line of String(logOutput || '').split('\n')) {
    const markerIndex = line.indexOf(CALLBACK_MARKER);
    if (markerIndex === -1) continue;

    const callback = line.slice(markerIndex + CALLBACK_MARKER.length);
    const jsonIndex = callback.indexOf('{');
    if (jsonIndex === -1) continue;

    try {
      events.push({
        ...JSON.parse(callback.slice(jsonIndex)),
        callback: callback.slice(0, jsonIndex).trim()
      });
    } catch {
      // Incremental log checkpoints can begin with an incomplete callback line.
    }
  }

  return events;
}

export function parseMaaCallbackEvents(logOutput, taskchain) {
  return parseMaaCallbackPayloads(logOutput)
    .filter(payload => payload.taskchain === taskchain);
}

function addDropItem(items, item) {
  const count = Number(item.addQuantity ?? item.quantity ?? 0);
  if (!Number.isFinite(count) || count <= 0) return;

  const itemId = String(item.itemId ?? item.id ?? '');
  const name = String(item.itemName ?? item.name ?? itemId);
  const existing = items.find(entry => entry.itemId === itemId && entry.name === name);
  if (existing) existing.count += count;
  else items.push({ itemId, name, count });
}

/**
 * Collapse Fight callback events into one structured result.
 *
 * `StageDrops.stats[].addQuantity` is the per-run delta; `quantity` is the
 * cumulative owned count. `FightTimes.sanity_cost` is emitted per fight.
 * `SanityBeforeStage` is used as a fallback for sanity when FightTimes is not
 * present in the checkpoint window.
 */
export function summarizeFightCallbacks(logOutput) {
  const payloads = parseMaaCallbackPayloads(logOutput);
  const items = [];
  let stage = null;
  let sanityCost = 0;
  let sanityBefore = null;
  let sanityAfter = null;

  for (const payload of payloads) {
    const details = payload.details || {};

    if (payload.what === 'StageDrops') {
      if (details.stage?.stageCode) stage = details.stage.stageCode;
      const stats = Array.isArray(details.stats) ? details.stats : [];
      const drops = stats.length > 0
        ? stats
        : Array.isArray(details.drops) ? details.drops : [];
      for (const item of drops) addDropItem(items, item);
    } else if (payload.what === 'FightTimes') {
      const cost = Number(details.sanity_cost);
      if (Number.isFinite(cost) && cost > 0) sanityCost += cost;
    } else if (payload.what === 'SanityBeforeStage') {
      const current = Number(details.current_sanity);
      if (Number.isFinite(current)) {
        if (sanityBefore === null) sanityBefore = current;
        sanityAfter = current;
      }
    }
  }

  const sanityUsed = sanityCost > 0
    ? sanityCost
    : (sanityBefore !== null && sanityAfter !== null && sanityBefore > sanityAfter
        ? sanityBefore - sanityAfter
        : 0);

  return { stage, items, sanityUsed, sanityBefore, sanityAfter };
}
