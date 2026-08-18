// MULTIPASS creation/restoration via UPassport's /g1nostr API — replaces the
// external g1.html/keygen redirect with an in-app flow (email + PIN, mirroring
// zelkova's multipass_service.dart create/restore logic).
import logger from "src/util/logger"

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

/**
 * Station list for the "choose your Astroport" picker: the base station
 * itself plus its known constellation peers (Ustats.sh's SWARM[], surfaced by
 * a plain GET / on the uSPOT API — the same data g1.html uses to draw its map).
 */
export async function fetchConstellationStations(
  baseApiUrl: string,
): Promise<ConstellationStation[]> {
  const base = baseApiUrl.replace(/\/$/, "")
  const stations: ConstellationStation[] = [{uSPOT: base, domain: new URL(base).hostname}]

  try {
    const res = await fetch(`${base}/`, {signal: AbortSignal.timeout(5000)})
    if (!res.ok) return stations

    const data = await res.json()

    // The base station reports its own myIPFS/myRELAY/IPCity/captain at the
    // root of the same payload — use them as-is, no derivation needed.
    Object.assign(stations[0], {
      ipCity: data.IPCity,
      captain: data.captain,
      myIPFS: data.myIPFS,
      myRELAY: data.myRELAY,
    })

    for (const s of data.SWARM || []) {
      if (s.uSPOT && !stations.some(st => st.uSPOT === s.uSPOT)) {
        stations.push({
          uSPOT: s.uSPOT,
          domain: new URL(s.uSPOT).hostname,
          ipCity: s.IPCity,
          captain: s.captain,
          myIPFS: s.myIPFS,
          myRELAY: s.myRELAY,
        })
      }
    }
  } catch (err) {
    logger.info("[multipass] Could not list constellation stations:", err)
  }

  return stations
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
