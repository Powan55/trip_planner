/**
 * `core/itinerary` barrel — the framework-free itinerary CRUD backbone (;
 *). Pure `DayPlan[]` transforms + selectors, extracted mechanically from
 * `hooks/use-itinerary.ts`. The hook is now the thin React adapter that reads the
 * freshest persisted base via the StoragePort, applies one of these transforms, persists
 * the result, and fans out to the SyncPort — none of which this module knows about.
 */
export {
  synthesizeDay,
  upsertDay,
  addItem,
  updateItem,
  removeItem,
  clearDay,
  moveItem,
  deleteItems,
  moveItems,
  copyDay,
  reorderItems,
  getDayPlan,
  findPlacements,
  noStamp,
  type ItemStamper,
} from './crud';
