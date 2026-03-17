/**
 * ipfs.ts — Shared IPFS gateway helpers.
 *
 * These utilities are used by VideoCard.svelte and NoteContentKind21.svelte
 * (and any future component) to convert raw CIDs or ipfs:// URIs into full
 * HTTP URLs routed through the correct IPFS gateway.
 *
 * Gateway selection logic (mirrors youtube.enhancements.js):
 *   • localhost / 127.0.0.1   → http://127.0.0.1:8080
 *   • ipfs.<domain>           → same proto + same host  (e.g. ipfs.copylaradio.com)
 *   • u.<domain>              → ipfs.<domain> (UPlanet subdomain convention)
 *   • anything else           → https://ipfs.copylaradio.com (production fallback)
 */

export const getIpfsGateway = (): string => {
  if (typeof window === "undefined") return "https://ipfs.copylaradio.com"
  const {hostname, protocol} = window.location
  const proto = protocol.replace(":", "")
  if (hostname === "127.0.0.1" || hostname === "localhost") return "http://127.0.0.1:8080"
  if (hostname.startsWith("ipfs.")) return `${proto}://${hostname}`
  if (hostname.startsWith("u.")) return `${proto}://ipfs.${hostname.slice(2)}`
  return "https://ipfs.copylaradio.com"
}

/**
 * Convert any IPFS reference to a fully-qualified http(s) URL.
 *
 * Handled input formats:
 *   • Already an http(s) URL          → returned as-is
 *   • ipfs://<CID>[/path]             → <gw>/ipfs/<CID>[/path]
 *   • /ipfs/<CID>[/path]              → <gw>/ipfs/<CID>[/path]
 *   • Bare CIDv0  (Qm… 46 chars)      → <gw>/ipfs/<CID>
 *   • Bare CIDv1  (bafy… ≥52 chars)   → <gw>/ipfs/<CID>
 *   • Anything else                   → returned as-is (external URL)
 */
export const resolveIpfsUrl = (url: string): string => {
  if (!url) return url
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  const gw = getIpfsGateway()
  if (url.startsWith("ipfs://")) return `${gw}/ipfs/${url.slice(7)}`
  if (url.startsWith("/ipfs/")) return `${gw}${url}`
  // Bare CIDv0 (Qm… 46 chars) or CIDv1 (bafy…)
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{50,})/.test(url)) return `${gw}/ipfs/${url}`
  return url
}
