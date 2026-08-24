// UPlanet/Astroport service resolution — two complementary needs:
//   - detectUPlanetServices()/getVerifiedUPlanet(): "is this genuinely UPlanet?" (strict,
//     returns null otherwise) — used to gate UPlanet-only UI (video menu, uploads, DMs).
//   - resolveApiUrl()/getApiUrl(): "give me a UPlanet API URL that works" (always
//     returns something, falling back to a public station) — used by ZEN balance
//     checks and the feedback form, which need an endpoint regardless of context.
// Priority for both: explicit user preference ("Vos relais") → the logged-in
// user's own home station (profile's ipfs_gw tag) → hostname auto-detection → default.
import {get} from "svelte/store"
import {Capacitor} from "@capacitor/core"
import {synced, localStorageProvider} from "@welshman/store"
import {pubkey, deriveProfile, getProfile} from "@welshman/app"
import logger from "src/util/logger"

export interface UPlanetServices {
  relayUrl: string
  apiUrl: string
  uploadUrl: string
  isLocal: boolean
}

export type ApiUrlSource = "preferred" | "home" | "detected" | "default"

export const DEFAULT_API_URL = "https://u.copylaradio.com"

/** User's manually chosen preferred UPlanet relay, set from the relay list ("Vos relais"). */
export const preferredRelayUrl = synced<string | null>({
  key: "uplanet/preferredRelayUrl",
  defaultValue: null,
  storage: localStorageProvider,
})

/**
 * The IPFS gateway of the station a MULTIPASS was created on, taken verbatim
 * from that station's own myIPFS field (src/util/multipass.ts) — never
 * derived from a hostname convention, since myIPFS is already the literal,
 * authoritative URL.
 */
export const preferredIpfsGateway = synced<string | null>({
  key: "uplanet/preferredIpfsGateway",
  defaultValue: null,
  storage: localStorageProvider,
})

/**
 * The API (uSPOT) URL of the station a MULTIPASS was created on, taken
 * verbatim from that station's own uSPOT field (src/util/multipass.ts) —
 * never re-derived from the relay's hostname.
 */
export const preferredApiUrl = synced<string | null>({
  key: "uplanet/preferredApiUrl",
  defaultValue: null,
  storage: localStorageProvider,
})

let _cached: UPlanetServices | null | undefined
let _verified: UPlanetServices | null = null

export const isPrivateIP = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname.startsWith("192.168.") ||
  hostname.startsWith("10.") ||
  Boolean(hostname.match(/^172\.(1[6-9]|2\d|3[01])\./))

/**
 * Derive {relayUrl, apiUrl, uploadUrl, isLocal} from a relay URL, mirroring
 * detectUPlanetServices' hostname convention: relay.<domain> <-> u.<domain>,
 * or port 7777 <-> 54321 for local/LAN gateways. Returns null if the relay
 * doesn't follow either convention (e.g. an unrelated public relay).
 */
export const servicesFromRelayUrl = (relayUrl: string): UPlanetServices | null => {
  try {
    const url = new URL(relayUrl)
    const httpProto = url.protocol === "wss:" ? "https" : "http"

    if (url.hostname.startsWith("relay.")) {
      const apiUrl = `${httpProto}://u.${url.hostname.slice(6)}`

      return {relayUrl, apiUrl, uploadUrl: `${apiUrl}/api/upload/image`, isLocal: false}
    }

    if (url.port === "7777") {
      const apiUrl = `${httpProto}://${url.hostname}:54321`

      return {
        relayUrl,
        apiUrl,
        uploadUrl: `${apiUrl}/api/upload/image`,
        isLocal: isPrivateIP(url.hostname),
      }
    }
  } catch {
    // invalid URL
  }

  return null
}

/**
 * Derive {relayUrl, apiUrl, uploadUrl, isLocal} from an IPFS gateway URL
 * (e.g. a profile's ipfs_gw tag), mirroring the same convention in reverse:
 * ipfs.<domain> <-> u.<domain>/relay.<domain>, or port 8080 <-> 54321/7777.
 */
const servicesFromIpfsGateway = (gatewayUrl: string): UPlanetServices | null => {
  try {
    const url = new URL(gatewayUrl)
    const wsProto = url.protocol === "https:" ? "wss" : "ws"

    if (url.hostname.startsWith("ipfs.")) {
      const domain = url.hostname.slice(5)
      const apiUrl = `${url.protocol}//u.${domain}`

      return {
        relayUrl: `${wsProto}://relay.${domain}`,
        apiUrl,
        uploadUrl: `${apiUrl}/api/upload/image`,
        isLocal: false,
      }
    }

    if (url.port === "8080") {
      const apiUrl = `${url.protocol}//${url.hostname}:54321`

      return {
        relayUrl: `${wsProto}://${url.hostname}:7777`,
        apiUrl,
        uploadUrl: `${apiUrl}/api/upload/image`,
        isLocal: isPrivateIP(url.hostname),
      }
    }
  } catch {
    // invalid URL
  }

  return null
}

/** Read a NIP-39 "i" tag value (e.g. "ipfs_gw:https://ipfs.example.com") from the
 * logged-in user's own profile — the only place fields like ipfs_gw ever live. */
const getOwnProfileTagValue = (key: string): string | null => {
  const $pubkey = get(pubkey)
  if (!$pubkey) return null

  const profile = getProfile($pubkey)
  const prefix = `${key}:`

  for (const tag of profile?.event?.tags || []) {
    if (tag[0] === "i" && typeof tag[1] === "string" && tag[1].startsWith(prefix)) {
      return tag[1].slice(prefix.length)
    }
  }

  return null
}

/**
 * The logged-in user's own home station, derived from their profile's
 * ipfs_gw tag (kept current by Astroport.ONE's NOSTRCARD.refresh.sh — see
 * Astroport.ONE/docs/reference/IDENTITY_MULTIPASS.md for the home_station field).
 */
const getHomeStationServices = (): UPlanetServices | null => {
  const gw = getOwnProfileTagValue("ipfs_gw")
  if (!gw) return null

  const services = servicesFromIpfsGateway(gw)
  if (!services) return null

  // A private/loopback ipfs_gw (the profile owner's own station/LAN) is only
  // reachable when THIS browsing context is also on that same network. Trusting
  // it unconditionally sent every visitor whose own profile happens to carry a
  // 127.0.0.1/192.168.* ipfs_gw down dead IPFS links on any other network — that
  // address means something completely different on their machine than on the
  // profile owner's.
  if (
    services.isLocal &&
    typeof globalThis.location !== "undefined" &&
    !isPrivateIP(globalThis.location.hostname)
  ) {
    return null
  }

  return services
}

export function detectUPlanetServices(): UPlanetServices | null {
  if (_cached !== undefined) return _cached

  if (typeof globalThis.location === "undefined") {
    _cached = null
    return null
  }

  // A native Capacitor app is always served from a fixed synthetic origin
  // (https://localhost) regardless of which network the device is actually
  // on — treating that as "browsing a local IPFS gateway" pointed every
  // native user at http://127.0.0.1:54321, an address that only ever means
  // something on a desktop browser's own machine, never on a phone.
  if (Capacitor.isNativePlatform()) {
    _cached = null
    return null
  }

  const {hostname, port, protocol} = globalThis.location
  const isSecure = protocol === "https:"
  const wsProto = isSecure ? "wss" : "ws"
  const httpProto = isSecure ? "https" : "http"

  let relayUrl: string
  let apiUrl: string
  let isLocal = false

  if (hostname.startsWith("ipfs.")) {
    // ipfs.example.com → relay.example.com / u.example.com (SSL proxy handles port)
    const domain = hostname.replace(/^ipfs\./, "")
    relayUrl = `${wsProto}://relay.${domain}`
    apiUrl = `${httpProto}://u.${domain}`
  } else if (isPrivateIP(hostname) && (port === "8080" || port === "")) {
    // Local or LAN IPFS gateway — explicit ports (no SSL proxy)
    relayUrl = `ws://${hostname === "localhost" ? "127.0.0.1" : hostname}:7777`
    apiUrl = `http://${hostname === "localhost" ? "127.0.0.1" : hostname}:54321`
    isLocal = true
  } else {
    _cached = null
    return null
  }

  _cached = {relayUrl, apiUrl, uploadUrl: `${apiUrl}/api/upload/image`, isLocal}
  return _cached
}

export async function verifyUPlanetServices(services: UPlanetServices): Promise<boolean> {
  try {
    const res = await fetch(`${services.apiUrl}/.well-known/nostr/nip96.json`, {
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      _verified = services
      logger.info("[UPlanet] Services detected:", services.relayUrl, services.apiUrl)
      return true
    }
  } catch {
    // ignore
  }

  logger.info("[UPlanet] Gateway detected but services unreachable, using defaults")
  _verified = null
  return false
}

export function getVerifiedUPlanet(): UPlanetServices | null {
  return _verified
}

/**
 * Detect + verify UPlanet services, following the shared priority order
 * (preferred relay → home station → hostname auto-detection), and re-checking
 * whenever the preference or the logged-in user's own profile changes.
 * Call once at app startup.
 */
export function initUPlanetServices(): void {
  let unsubProfile: (() => void) | null = null

  const check = () => {
    const preferred = get(preferredRelayUrl)
    const services =
      (preferred && servicesFromRelayUrl(preferred)) ||
      getHomeStationServices() ||
      detectUPlanetServices()

    if (services) {
      verifyUPlanetServices(services)
    } else {
      _verified = null
    }
  }

  check()
  preferredRelayUrl.subscribe(check)

  // The user's profile (and its ipfs_gw tag) usually loads asynchronously
  // after this module first runs — re-check once it (or a later pubkey) arrives.
  pubkey.subscribe($pubkey => {
    unsubProfile?.()
    unsubProfile = $pubkey ? deriveProfile($pubkey).subscribe(check) : null
  })
}

// ── Always-usable API URL (merged from src/util/zen.ts) ─────────────────────

let _cachedFallback: string | null = null
let _cachedFallbackPromise: Promise<string> | null = null

const resolveFallbackApiUrl = async (): Promise<string> => {
  if (_cachedFallback !== null) return _cachedFallback

  if (!_cachedFallbackPromise) {
    _cachedFallbackPromise = (async () => {
      const detected = detectUPlanetServices()?.apiUrl

      if (!detected) {
        _cachedFallback = DEFAULT_API_URL
        return DEFAULT_API_URL
      }

      try {
        const res = await fetch(`${detected}/.well-known/nostr/nip96.json`, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          logger.info("[UPlanet] Local API reachable:", detected)
          _cachedFallback = detected
          return detected
        }
      } catch {
        // Local instance unreachable or too slow — fall back silently
      }

      logger.info("[UPlanet] Local API not reachable, using fallback:", DEFAULT_API_URL)
      _cachedFallback = DEFAULT_API_URL
      return DEFAULT_API_URL
    })()
  }

  return _cachedFallbackPromise
}

/**
 * Resolve {url, source} following: explicit preference → home station →
 * detected + health-checked station → public default (u.copylaradio.com).
 * Synchronous — no live health check for the "detected" tier (uses whatever
 * was last resolved by resolveApiUrl(), if anything). Prefer resolveApiUrl()
 * when an async context is available.
 */
export function getApiUrlWithSource(): {url: string; source: ApiUrlSource} {
  const directApiUrl = get(preferredApiUrl)
  if (directApiUrl) return {url: directApiUrl, source: "preferred"}

  const preferred = get(preferredRelayUrl)

  if (preferred) {
    const services = servicesFromRelayUrl(preferred)
    if (services) return {url: services.apiUrl, source: "preferred"}
  }

  const home = getHomeStationServices()
  if (home) return {url: home.apiUrl, source: "home"}

  const detected = detectUPlanetServices()?.apiUrl
  if (detected) return {url: _cachedFallback || detected, source: "detected"}

  return {url: _cachedFallback || DEFAULT_API_URL, source: "default"}
}

/**
 * Resolve a UPlanet API URL that's always usable: explicit user preference →
 * home station → detected + health-checked station → public default.
 * Prefer this over getApiUrl() whenever an async context is available.
 */
export async function resolveApiUrl(): Promise<string> {
  const directApiUrl = get(preferredApiUrl)
  if (directApiUrl) return directApiUrl

  const preferred = get(preferredRelayUrl)

  if (preferred) {
    const services = servicesFromRelayUrl(preferred)
    if (services) return services.apiUrl
  }

  const home = getHomeStationServices()
  if (home) return home.apiUrl

  return resolveFallbackApiUrl()
}

/**
 * Synchronous best-effort API URL (no live health check) — for contexts that
 * can't await, e.g. template hrefs. Prefer resolveApiUrl() when possible.
 */
export function getApiUrl(): string {
  return getApiUrlWithSource().url
}

/** Derive an IPFS gateway URL from a UPlanet API URL: u.<domain> -> ipfs.<domain>, :54321 -> :8080. */
export const apiUrlToIpfsGateway = (apiUrl: string): string | null => {
  try {
    const url = new URL(apiUrl)

    if (url.hostname.startsWith("u.")) {
      return `${url.protocol}//ipfs.${url.hostname.slice(2)}`
    }

    if (url.port === "54321") {
      return `${url.protocol}//${url.hostname}:8080`
    }
  } catch {
    // invalid URL
  }

  return null
}

/**
 * IPFS gateway matching the chosen/detected UPlanet API station (preferred
 * relay → home station → hostname auto-detection) — so CIDs (videos,
 * images...) resolve through the same station regardless of where coracle
 * itself is hosted. Returns null only when nothing but the public default is
 * known, so callers can fall back to their own default gateway string.
 */
export function getPreferredIpfsGateway(): string | null {
  const direct = get(preferredIpfsGateway)
  if (direct) return direct

  const {url, source} = getApiUrlWithSource()

  return source === "default" ? null : apiUrlToIpfsGateway(url)
}
