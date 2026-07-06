/**
 * `core/itinerary` barrel — the framework-free itinerary CRUD backbone.
 * Pure `DayPlan[]` transforms + selectors. The hook (`hooks/use-itinerary.ts`) is the
 * thin React adapter that reads the freshest persisted base via the StoragePort, applies
 * one of these transforms, persists the result, and fans out to the SyncPort — none of
 * which this module knows about.
 */
export {
  synthesizeDay,
  upsertDay,
  addItem,
  updateItem,
  removeItem,
  moveItem,
  reorderItems,
  getDayPlan,
  findPlacements,
  noStamp,
  type ItemStamper,
} from './crud';
