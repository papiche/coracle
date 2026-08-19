/**
 * geo.ts — UPlanet geographic hierarchy (UMAP/SECTOR/REGION) helpers, ported
 * bit-for-bit from Astroport.ONE's own bash implementation so that a cell id
 * computed here always matches the one the server computes for the same
 * coordinates — critical since these ids gate which SECTOR/REGION journal a
 * liked message gets promoted into (NOSTR.UMAP.refresh.sh, create_aggregate_journal).
 *
 * Hierarchy (Astroport.ONE/tools/my.sh:makecoord, UPLANET.refresh.sh):
 *   UMAP   0.01° — lat/lon rounded to 2 decimals (e.g. "43.60")
 *   SECTOR 0.1°  — UMAP string with its last character dropped ("43.60" -> "43.6"),
 *                  i.e. TRUNCATION, not rounding: 43.69 stays in sector 43.6.
 *   REGION 1°    — integer part only ("43.60" -> "43"), string split on ".",
 *                  i.e. truncation toward zero, not Math.floor.
 */

export interface GeoCell {
  lat: string
  lon: string
}

export type GeoLevel = "umap" | "sector" | "region"

/** UMAP cell for a raw coordinate — lat/lon rounded to 0.01°. */
export const toUmap = (lat: number, lon: number): GeoCell => ({
  lat: lat.toFixed(2),
  lon: lon.toFixed(2),
})

/** SECTOR cell derived from a (already 2-decimal) UMAP lat/lon string pair. */
export const toSector = (umap: GeoCell): GeoCell => ({
  lat: umap.lat.slice(0, -1),
  lon: umap.lon.slice(0, -1),
})

/** REGION cell derived from a (already 2-decimal) UMAP lat/lon string pair. */
export const toRegion = (umap: GeoCell): GeoCell => ({
  lat: umap.lat.split(".")[0],
  lon: umap.lon.split(".")[0],
})

export const geoCellId = (cell: GeoCell): string => `${cell.lat}_${cell.lon}`

export const geoCellLabel = (level: GeoLevel, cell: GeoCell): string => {
  const prefix = level === "umap" ? "UMAP" : level === "sector" ? "Secteur" : "Région"
  return `${prefix} ${geoCellId(cell)}`
}

const EARTH_RADIUS_KM = 6371

/** Great-circle distance between two lat/lon points, in kilometers. */
export const haversineDistanceKm = (
  a: {lat: number; lon: number},
  b: {lat: number; lon: number},
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** Browser geolocation → UMAP cell, or throws if unavailable/denied. */
export const getCurrentUmap = (): Promise<GeoCell> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Géolocalisation non disponible"))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(toUmap(pos.coords.latitude, pos.coords.longitude)),
      err => reject(err),
    )
  })

/**
 * Does an event's own latitude/longitude tags fall within the given geo cell
 * at the given level? Both sides go through the same truncation functions,
 * so an event tagged with any UMAP inside a SECTOR/REGION matches that
 * SECTOR/REGION even though its own tags are always UMAP-precision (2 decimals).
 */
export const matchesGeoCell = (
  eventLat: string,
  eventLon: string,
  level: GeoLevel,
  cell: GeoCell,
): boolean => {
  if (!eventLat || !eventLon) return false

  const eventUmap: GeoCell = {lat: eventLat, lon: eventLon}
  const eventCell =
    level === "umap" ? eventUmap : level === "sector" ? toSector(eventUmap) : toRegion(eventUmap)

  return eventCell.lat === cell.lat && eventCell.lon === cell.lon
}
