/**
 * migrations.ts — IndexedDB schema migrations for the "coracle" database.
 *
 * Called by storage.ts inside the `upgrade()` hook of openDB().
 * Each numbered block is executed only on the first open at that version.
 * Keep this file as the single source of truth for schema history.
 *
 * Current version: 9
 * To add a new version:
 *   1. Increment the version constant in state.ts (initStorage call)
 *   2. Add a `case <version>:` block below (fall-through is intentional — IDB
 *      runs all cases from oldVersion+1 up to newVersion in sequence)
 */

import type {IDBPDatabase} from "idb"
import logger from "src/util/logger"

/**
 * Run all pending schema migrations.
 *
 * @param db         - Raw IDBPDatabase instance from the upgrade hook
 * @param oldVersion - Previous database version (0 on first open)
 * @param newVersion - Target database version
 * @param names      - Current store names defined by adapters (used for v1 creation)
 * @param keyPaths   - Map of store name → keyPath (used for store creation)
 */
export function runMigrations(
  db: IDBPDatabase,
  oldVersion: number,
  newVersion: number,
  keyPaths: Record<string, string>,
): void {
  logger.info(`[DB] Migrating "coracle" v${oldVersion} → v${newVersion}`)

  // Use a switch with fall-through so all intermediate migrations always run.
  // eslint-disable-next-line default-case
  switch (true) {
    // v1-v8: Initial schema — all stores were created/deleted declaratively.
    // These versions did not have explicit migration code; the upgrade handler
    // in storage.ts handled creation and removal of stores generically.
    // We reproduce the same behaviour here for completeness when upgrading
    // from very old clients.
    case oldVersion < 1: {
      logger.info("[DB] v1: creating initial object stores")
      for (const [name, keyPath] of Object.entries(keyPaths)) {
        if (!db.objectStoreNames.contains(name)) {
          try {
            db.createObjectStore(name, {keyPath})
          } catch (e) {
            logger.warn(`[DB] v1: could not create store "${name}":`, e)
          }
        }
      }
      if (oldVersion >= 1) break
    }
    // eslint-disable-next-line no-fallthrough
    case oldVersion < 9: {
      // v9 (current): remove any stores not declared in the current adapter list
      // and ensure all declared stores exist. This mirrors what the old generic
      // upgrade handler did but is now explicit and traceable.
      logger.info("[DB] v9: reconciling object stores")
      for (const name of Array.from(db.objectStoreNames)) {
        if (!keyPaths[name]) {
          logger.info(`[DB] v9: dropping obsolete store "${name}"`)
          db.deleteObjectStore(name)
        }
      }
      for (const [name, keyPath] of Object.entries(keyPaths)) {
        if (!db.objectStoreNames.contains(name)) {
          try {
            db.createObjectStore(name, {keyPath})
            logger.info(`[DB] v9: created store "${name}"`)
          } catch (e) {
            logger.warn(`[DB] v9: could not create store "${name}":`, e)
          }
        }
      }
      break
    }
  }

  logger.info("[DB] Migration complete")
}
