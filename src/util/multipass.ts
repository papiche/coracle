// MULTIPASS creation/restoration via UPassport's /g1nostr API — replaces the
// external g1.html/keygen redirect with an in-app flow (email + PIN, mirroring
// zelkova's multipass_service.dart create/restore logic).
import logger from "src/util/logger"
import {detectUPlanetServices} from "src/util/uplanet-detect"

export interface ConstellationStation {
  uSPOT: string
  // Derived from uSPOT's own URL — never the station's self-reported
  // "hostname" field, which is its local/LAN machine name (e.g.
  // "nexus.localhost") and unrelated to the public domain that serves it.
  domain: string
  ipCity?: string
  captain?: string
  myIPFS?: string
  myRELAY?: string
  ipfsnodeid?: string
  // Station's own GPS coordinates (Astroport.ONE's STATION_LAT/STATION_LON),
  // as reported — "0"/"0" means the station has none configured.
  lat?: string
  lon?: string
  // Weekly PAF ("Participation Aux Frais"), in Ẑen.
  paf?: string
  // Available disk space in GB. Present at the root for the base station;
  // absent for swarm peers until enriched via enrichStationsWithDiskSpace().
  availableSpaceGb?: number
}

export interface MultipassResult {
  email: string
  nsec: string
  npub: string
  hex: string
  pass: string
  ssss: string
  g1pub: string
  nostrns?: string
  salt: string
  pepper: string
  is_origin?: boolean
  uplanet_home?: string
}

export type MultipassErrorCode =
  | "MULTIPASS_EXISTS"
  | "INVALID_PASS"
  | "PASS_UNAVAILABLE"
  | "IDENTITY_CONFLICT"
  | "CREATION_IN_PROGRESS"
  | "UNKNOWN"

export class MultipassError extends Error {
  code: MultipassErrorCode

  constructor(code: MultipassErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface ConstellationStationsResult {
  stations: ConstellationStation[]
  // Swarm peers reported as loopback (127.0.0.1/localhost) and hidden from
  // `stations` because they're only reachable from their own machine — not
  // from wherever this browser happens to be.
  hiddenLoopbackCount: number
}

const isLoopbackHost = (host: string) =>
  host === "127.0.0.1" || host === "localhost" || host === "::1"

/**
 * Station list for the "choose your Astroport" picker: the base station
 * itself plus its known constellation peers (Ustats.sh's SWARM[], surfaced by
 * a plain GET / on the uSPOT API — the same data g1.html uses to draw its map).
 *
 * A peer whose uSPOT is a loopback address (127.0.0.1/localhost) can't be
 * reached from a browser anywhere but that station's own machine, so it's
 * filtered out — unless coracle itself is currently being served from a
 * local Astroport gateway, in which case "127.0.0.1" genuinely means this
 * machine and stays visible.
 */
export async function fetchConstellationStations(
  baseApiUrl: string,
): Promise<ConstellationStationsResult> {
  const base = baseApiUrl.replace(/\/$/, "")
  const all: ConstellationStation[] = [{uSPOT: base, domain: new URL(base).hostname}]

  try {
    const res = await fetch(`${base}/`, {signal: AbortSignal.timeout(5000)})
    if (res.ok) {
      const data = await res.json()

      // The base station reports its own myIPFS/myRELAY/IPCity/captain at the
      // root of the same payload — use them as-is, no derivation needed.
      Object.assign(all[0], {
        ipCity: data.IPCity,
        captain: data.captain,
        myIPFS: data.myIPFS,
        myRELAY: data.myRELAY,
        ipfsnodeid: data.IPFSNODEID || data.ipfsnodeid,
        lat: data.STATION_LAT,
        lon: data.STATION_LON,
        paf: data.PAF,
        availableSpaceGb: data.capacities?.available_space_gb,
      })

      for (const s of data.SWARM || []) {
        if (s.uSPOT && !all.some(st => st.uSPOT === s.uSPOT)) {
          all.push({
            uSPOT: s.uSPOT,
            domain: new URL(s.uSPOT).hostname,
            ipCity: s.IPCity,
            captain: s.captain,
            myIPFS: s.myIPFS,
            myRELAY: s.myRELAY,
            ipfsnodeid: s.ipfsnodeid,
            lat: s.STATION_LAT,
            lon: s.STATION_LON,
            paf: s.PAF,
            // s.capacities is a restricted projection (Astroport.ONE's
            // Ustats.sh SWARM[] filter) that drops available_space_gb —
            // enrichStationsWithDiskSpace() fills this in separately, per
            // peer, straight from its own published 12345.json.
          })
        }
      }
    }
  } catch (err) {
    logger.info("[multipass] Could not list constellation stations:", err)
  }

  if (detectUPlanetServices()?.isLocal) {
    return {stations: all, hiddenLoopbackCount: 0}
  }

  const stations = all.filter(s => !isLoopbackHost(s.domain))
  return {stations, hiddenLoopbackCount: all.length - stations.length}
}

/**
 * Best-effort enrichment: fill in availableSpaceGb for stations missing it
 * (i.e. swarm peers, whose entry in the base station's SWARM[] doesn't carry
 * it) by fetching each one's own unfiltered /ipns/<ipfsnodeid>/12345.json —
 * the full state Astroport.ONE publishes for that station, straight from its
 * own myIPFS gateway. Mutates the given stations in place; returns once every
 * fetch has settled (success or failure) so callers can re-render.
 */
export async function enrichStationsWithDiskSpace(stations: ConstellationStation[]): Promise<void> {
  await Promise.all(
    stations
      .filter(s => s.availableSpaceGb === undefined && s.myIPFS && s.ipfsnodeid)
      .map(async s => {
        try {
          const res = await fetch(
            `${s.myIPFS!.replace(/\/$/, "")}/ipns/${s.ipfsnodeid}/12345.json`,
            {signal: AbortSignal.timeout(5000)},
          )
          if (!res.ok) return

          const json = await res.json()
          const gb = json?.capacities?.available_space_gb

          if (typeof gb === "number") s.availableSpaceGb = gb
        } catch (err) {
          logger.info(`[multipass] Could not fetch disk space for ${s.domain}:`, err)
        }
      }),
  )
}

const LANG_2LETTER = /^[a-z]{2}$/

const ERROR_MESSAGES: Record<MultipassErrorCode, string> = {
  MULTIPASS_EXISTS: "This account already exists — a PASS code is required to restore it.",
  INVALID_PASS: "Incorrect PASS code.",
  PASS_UNAVAILABLE: "The PASS code is unavailable for this account.",
  IDENTITY_CONFLICT: "These details match a different existing account.",
  CREATION_IN_PROGRESS: "A creation is already in progress for this email, try again shortly.",
  UNKNOWN: "MULTIPASS request failed.",
}

/**
 * Create or restore a MULTIPASS on the given station — same endpoint, same
 * shape as zelkova's createMultipass(): no pass_code on first try; a 409
 * MULTIPASS_EXISTS means the caller should re-submit with the user's PIN.
 */
export async function createOrRestoreMultipass(
  stationUrl: string,
  {
    email,
    lang,
    lat,
    lon,
    passCode,
  }: {email: string; lang: string; lat?: string; lon?: string; passCode?: string},
): Promise<MultipassResult> {
  const form = new FormData()
  form.set("email", email.trim())
  form.set("lang", LANG_2LETTER.test(lang) ? lang : "fr")
  form.set("lat", lat || "")
  form.set("lon", lon || "")
  form.set("salt", "")
  form.set("pepper", "")
  form.set("format", "json")
  if (passCode) form.set("pass_code", passCode)

  const res = await fetch(`${stationUrl.replace(/\/$/, "")}/g1nostr`, {method: "POST", body: form})

  let data: any = null
  try {
    data = await res.json()
  } catch {
    // non-JSON error body (e.g. a proxy error page)
  }

  if (res.ok) return data as MultipassResult

  const code: MultipassErrorCode =
    data?.error in ERROR_MESSAGES ? (data.error as MultipassErrorCode) : "UNKNOWN"

  throw new MultipassError(code, data?.detail || data?.message || ERROR_MESSAGES[code])
}
