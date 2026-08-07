// UPlanet/Astroport service resolution — two complementary needs:
//   - detectUPlanetServices()/getVerifiedUPlanet(): "is this genuinely UPlanet?" (strict,
//     returns null otherwise) — used to gate UPlanet-only UI (video menu, uploads, DMs).
//   - resolveApiUrl()/getApiUrl(): "give me a UPlanet API URL that works" (always
//     returns something, falling back to a public station) — used by ZEN balance
//     checks and the feedback form, which need an endpoint regardless of context.
// Both respect the user's preferred relay ("Vos relais"), which overrides auto-detection.
import {get} from "svelte/store"
import {synced, localStorageProvider} from "@welshman/store"
import logger from "src/util/logger"

export interface UPlanetServices {
  relayUrl: string
  apiUrl: string
  uploadUrl: string
  isLocal: boolean
}

export const DEFAULT_API_URL = "https://u.copylaradio.com"

/** User's manually chosen preferred UPlanet relay, set from the relay list ("Vos relais"). */
export const preferredRelayUrl = synced<string | null>({
  key: "uplanet/preferredRelayUrl",
  defaultValue: null,
  storage: localStorageProvider,
})

let _cached: UPlanetServices | null | undefined
let _verified: UPlanetServices | null = null

const isPrivateIP = (hostname: string) =>
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

export function detectUPlanetServices(): UPlanetServices | null {
  if (_cached !== undefined) return _cached

  if (typeof globalThis.location === "undefined") {
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
 * Detect + verify UPlanet services, preferring the user's manually chosen relay
 * over hostname auto-detection, and re-checking whenever that preference changes.
 * Call once at app startup.
 */
export function initUPlanetServices(): void {
  const check = () => {
    const preferred = get(preferredRelayUrl)
    const services = (preferred && servicesFromRelayUrl(preferred)) || detectUPlanetServices()

    if (services) {
      verifyUPlanetServices(services)
    } else {
      _verified = null
    }
  }

  check()
  preferredRelayUrl.subscribe(check)
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
 * Resolve a UPlanet API URL that's always usable: explicit user preference →
 * detected + health-checked station → public default (u.copylaradio.com).
 * Prefer this over getApiUrl() whenever an async context is available.
 */
export async function resolveApiUrl(): Promise<string> {
  const preferred = get(preferredRelayUrl)

  if (preferred) {
    const services = servicesFromRelayUrl(preferred)
    if (services) return services.apiUrl
  }

  return resolveFallbackApiUrl()
}

/**
 * Synchronous best-effort API URL (no live health check) — for contexts that
 * can't await, e.g. template hrefs. Prefer resolveApiUrl() when possible.
 */
export function getApiUrl(): string {
  const preferred = get(preferredRelayUrl)

  if (preferred) {
    const services = servicesFromRelayUrl(preferred)
    if (services) return services.apiUrl
  }

  if (_cachedFallback) return _cachedFallback

  return detectUPlanetServices()?.apiUrl || DEFAULT_API_URL
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
 * relay first, then hostname auto-detection) — so CIDs (videos, images...)
 * resolve through the same station regardless of where coracle itself is
 * hosted. Returns null if no UPlanet station is known, for callers to fall
 * back to their own default.
 */
export function getPreferredIpfsGateway(): string | null {
  const preferred = get(preferredRelayUrl)

  if (preferred) {
    const services = servicesFromRelayUrl(preferred)
    if (services) {
      const gw = apiUrlToIpfsGateway(services.apiUrl)
      if (gw) return gw
    }
  }

  const detected = detectUPlanetServices()
  if (detected) {
    const gw = apiUrlToIpfsGateway(detected.apiUrl)
    if (gw) return gw
  }

  return null
}
