// MULTIPASS creation/restoration via UPassport's /g1nostr API — replaces the
// external g1.html/keygen redirect with an in-app flow (email + PIN, mirroring
// zelkova's multipass_service.dart create/restore logic).
import logger from "src/util/logger"
import {detectUPlanetServices, isPrivateIP} from "src/util/uplanet-detect"

export interface ConstellationStation {
  uSPOT: string
  // Derived from uSPOT's own URL — never the station's self-reported
  // "hostname" field, which is its local/LAN machine name (e.g.
  // "nexus.localhost") and unrelated to the public domain that serves it.
  domain: string
  ipCity?: string
  captain?: string
  // Nostr pubkey (hex) of the station's captain — for showing/linking their profile.
  captainHEX?: string
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
  | "MULTIPASS_NOT_FOUND"
  | "INVALID_PASS"
  | "PASS_UNAVAILABLE"
  | "PASS_DISABLED"
  | "IDENTITY_CONFLICT"
  | "CREATION_IN_PROGRESS"
  | "NETWORK_ERROR"
  | "UNKNOWN"

export class MultipassError extends Error {
  code: MultipassErrorCode
  /** Set by UPassport when this failure locked the PASS server-side. */
  locked: boolean

  constructor(code: MultipassErrorCode, message: string, locked = false) {
    super(message)
    this.code = code
    this.locked = locked
  }
}

export interface ConstellationStationsResult {
  stations: ConstellationStation[]
  // Swarm peers reported as loopback/private-LAN (127.0.0.1, 192.168.*, …)
  // and hidden from `stations` because they're only reachable from their own
  // machine/network — not from wherever this browser or app happens to be.
  hiddenLoopbackCount: number
}

/**
 * Station list for the "choose your Astroport" picker: the base station
 * itself plus its known constellation peers (Ustats.sh's SWARM[], surfaced by
 * a plain GET / on the uSPOT API — the same data g1.html uses to draw its map).
 *
 * A peer whose uSPOT is a loopback/private-LAN address (127.0.0.1,
 * 192.168.*, 10.*, 172.16-31.*) can't be reached from a browser or native app
 * anywhere but that same machine/network, so it's filtered out — unless
 * coracle itself is currently being served from a local Astroport gateway on
 * that same network, in which case it genuinely stays reachable. The base
 * station itself is never filtered: it's whatever resolveApiUrl() already
 * health-checked as reachable, regardless of what its address looks like.
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
        captainHEX: data.captainHEX,
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
            captainHEX: s.captainHEX,
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

  const [baseStation, ...peers] = all
  const reachablePeers = peers.filter(s => !isPrivateIP(s.domain))

  return {
    stations: [baseStation, ...reachablePeers],
    hiddenLoopbackCount: peers.length - reachablePeers.length,
  }
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
  MULTIPASS_NOT_FOUND: "No MULTIPASS found for this email on this station.",
  INVALID_PASS: "Incorrect PASS code.",
  PASS_UNAVAILABLE: "The PASS code is unavailable for this account.",
  PASS_DISABLED: "PASS recovery is disabled for this account — contact your station's Captain.",
  IDENTITY_CONFLICT: "These details match a different existing account.",
  CREATION_IN_PROGRESS: "A creation is already in progress for this email, try again shortly.",
  NETWORK_ERROR: "Could not reach this station — check your connection or pick a different one.",
  UNKNOWN: "MULTIPASS request failed.",
}

/**
 * Restore an existing MULTIPASS on the given station — same endpoint, same
 * shape as zelkova's createMultipass(): no pass_code on first try; a 409
 * MULTIPASS_EXISTS means the caller should re-submit with the user's PIN.
 *
 * Always sends recover_only=true (mirrors zelkova's doctrine): coracle no
 * longer creates a new MULTIPASS itself — an unknown email gets a 404
 * MULTIPASS_NOT_FOUND instead of a silently-created empty account, in case
 * the user picked the wrong station. New accounts are created on
 * UPlanet/earth (see keygenUrl in InviteCreate.svelte / MultipassLogin.svelte).
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
  // lat/lon sont des champs Form REQUIS côté UPassport (G1NostrForm) : une
  // chaîne vide est vue comme absente → 422 avant toute vérif du PASS. Sans
  // géolocalisation, "0.00" comme zelkova (ignoré en récupération).
  form.set("lat", lat || "0.00")
  form.set("lon", lon || "0.00")
  form.set("salt", "")
  form.set("pepper", "")
  form.set("format", "json")
  form.set("recover_only", "true")
  if (passCode) form.set("pass_code", passCode)

  const cleanUrl = stationUrl.replace(/\/$/, "")

  let res: Response
  try {
    res = await fetch(`${cleanUrl}/g1nostr`, {method: "POST", body: form})
  } catch (err) {
    // A thrown fetch (DNS failure, connection refused, blocked mixed
    // content…) means this station is simply unreachable from here — surface
    // that distinctly instead of letting it fall through as "UNKNOWN".
    throw new MultipassError(
      "NETWORK_ERROR",
      `Could not reach ${cleanUrl}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let data: any = null
  try {
    data = await res.json()
  } catch {
    // non-JSON error body (e.g. a proxy error page)
  }

  if (res.ok) return data as MultipassResult

  const code: MultipassErrorCode =
    data?.error in ERROR_MESSAGES ? (data.error as MultipassErrorCode) : "UNKNOWN"

  throw new MultipassError(
    code,
    data?.detail || data?.message || ERROR_MESSAGES[code],
    data?.locked === true,
  )
}

/**
 * Report failed PASS attempts to the station — after 3 consecutive
 * failures, POST /g1nostr/alert invalidates this account's PASS and emails
 * the captain (see UPassport routers/identity.py::pass_attempts_alert).
 * Best-effort: a network failure here must never block the UI, the caller
 * already treats the account as locked at this point.
 */
export async function reportPassAttempts(
  stationUrl: string,
  email: string,
  attempts: number,
): Promise<void> {
  const cleanUrl = stationUrl.replace(/\/$/, "")

  try {
    await fetch(`${cleanUrl}/g1nostr/alert`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email: email.trim(), attempts}),
    })
  } catch (err) {
    logger.info("[multipass] Could not report PASS attempts:", err)
  }
}

/**
 * Look up which constellation station already hosts a MULTIPASS for this
 * email — recovery only works from that station's own g1.sh/nostr data, so
 * guessing wrong wastes a round trip through MULTIPASS_NOT_FOUND. Mirrors
 * zelkova's home_station_lookup.dart: queries a NOSTR relay for a kind 0
 * profile tagged `["i","email:<email>",""]` (written by
 * Astroport.ONE/tools/nostr_setup_profile.py) and reads
 * `content.home_station` ("IPFSNODEID:NODE_HEX"). Constellation-wide thanks
 * to backfill_constellation.sh (daily swarm sync), so querying any single
 * relay is enough — with up to 24h sync latency. Returns the IPFSNODEID
 * half, or null if absent from this relay / unreachable / timed out.
 */
export async function queryHomeStationForEmail(
  email: string,
  relayUrl: string,
): Promise<string | null> {
  if (!relayUrl) return null

  return new Promise<string | null>(resolve => {
    let settled = false
    let ws: WebSocket

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        // already closed
      }
      resolve(value)
    }

    const timer = setTimeout(() => finish(null), 6000)

    try {
      ws = new WebSocket(relayUrl)
    } catch (err) {
      logger.info("[multipass] Home station lookup: could not open relay:", err)
      clearTimeout(timer)
      resolve(null)
      return
    }

    const subId = `hs_${Math.random().toString(36).slice(2)}`

    ws.onopen = () => {
      ws.send(JSON.stringify(["REQ", subId, {kinds: [0], "#i": [`email:${email}`], limit: 1}]))
    }

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg[0] === "EOSE") {
          finish(null)
        } else if (msg[0] === "EVENT" && msg[2]?.kind === 0) {
          const content = JSON.parse(msg[2].content || "{}")
          const homeStation: string | undefined = content.home_station
          finish(homeStation ? homeStation.split(":")[0] : null)
        }
      } catch (err) {
        logger.info("[multipass] Home station lookup: parse error:", err)
      }
    }

    ws.onerror = () => finish(null)
    ws.onclose = () => finish(null)
  })
}
