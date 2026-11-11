/**
 * uenc.ts — pièces jointes chiffrées des messages privés (format UENC v2, STREAM, partagé avec
 * astroportd `crates/astro-crypto/src/uenc/v2.rs` et Astroport.ONE/tools/uenc_codec.py) :
 * en-tête de 14 octets `UENC` + version(1 = 2) + type(1) + chunk_log2(1) + préfixe de nonce(7), puis des blocs de
 * 64 Kio de clair chiffrés + étiquette(16), AES-256-GCM. Nonce de chaque bloc = préfixe + indice (u32 BE) +
 * drapeau « dernier bloc » ; l'en-tête complet est la donnée associée (AAD), donc réordonner ou tronquer échoue.
 * Le chiffrement se fait ICI : la station ne reçoit que des octets illisibles et ne connaît pas la clé.
 * L'ancien format v1 n'est plus lu ni écrit.
 */
import {bytesToHex, hexToBytes} from "@welshman/lib"

const MAGIC = [0x55, 0x45, 0x4e, 0x43] // "UENC"
const VERSION = 2
const AES256GCM = 1
const CHUNK_LOG2 = 16
const HEADER = 14
const PREFIX_LEN = 7
const TAG_LEN = 16
const MIN_CHUNK_LOG2 = 12
const MAX_CHUNK_LOG2 = 24

export type EncryptedAttachment = {payload: Uint8Array; keyHex: string; ivHex: string}

const nonce = (prefix: Uint8Array, index: number, last: boolean) => {
  const n = new Uint8Array(12)

  n.set(prefix, 0)
  new DataView(n.buffer).setUint32(PREFIX_LEN, index, false)
  n[11] = last ? 1 : 0

  return n
}

/** `ivHex` est le préfixe de nonce (7 octets), informatif : le déchiffrement le relit dans l'en-tête. */
export const encryptUenc = async (data: ArrayBuffer): Promise<EncryptedAttachment> => {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const prefix = crypto.getRandomValues(new Uint8Array(PREFIX_LEN))
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"])
  const header = new Uint8Array(HEADER)

  header.set(MAGIC, 0)
  header[4] = VERSION
  header[5] = AES256GCM
  header[6] = CHUNK_LOG2
  header.set(prefix, 7)

  const plain = new Uint8Array(data)
  const size = 1 << CHUNK_LOG2
  const count = Math.max(1, Math.ceil(plain.length / size)) // au moins un bloc, éventuellement vide
  const parts: Uint8Array[] = [header]

  for (let i = 0; i < count; i++) {
    const sealed = await crypto.subtle.encrypt(
      {name: "AES-GCM", iv: nonce(prefix, i, i === count - 1), additionalData: header, tagLength: 128},
      key,
      plain.subarray(i * size, (i + 1) * size),
    )

    parts.push(new Uint8Array(sealed))
  }

  const payload = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0

  for (const p of parts) {
    payload.set(p, at)
    at += p.length
  }

  return {payload, keyHex: bytesToHex(raw), ivHex: bytesToHex(prefix)}
}

/** Le préfixe de nonce est lu dans l'en-tête (comme uenc_codec.py), pas dans le message. AES-256-GCM seulement. */
export const decryptUenc = async (bytes: Uint8Array, keyHex: string): Promise<ArrayBuffer> => {
  const chunkLog2 = bytes[6]

  if (
    bytes.length < HEADER + TAG_LEN ||
    !MAGIC.every((b, i) => bytes[i] === b) ||
    bytes[4] !== VERSION ||
    bytes[5] !== AES256GCM ||
    !(chunkLog2 >= MIN_CHUNK_LOG2 && chunkLog2 <= MAX_CHUNK_LOG2)
  ) {
    throw new Error("Invalid UENC payload")
  }

  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, [
    "decrypt",
  ])
  const header = bytes.slice(0, HEADER)
  const prefix = header.slice(7, HEADER)
  const sealedSize = (1 << chunkLog2) + TAG_LEN
  const body = bytes.subarray(HEADER)
  const count = Math.ceil(body.length / sealedSize)

  if (body.length - (count - 1) * sealedSize < TAG_LEN) throw new Error("Invalid UENC payload")

  const parts: Uint8Array[] = []

  for (let i = 0; i < count; i++) {
    const plain = await crypto.subtle.decrypt(
      {name: "AES-GCM", iv: nonce(prefix, i, i === count - 1), additionalData: header, tagLength: 128},
      key,
      body.subarray(i * sealedSize, (i + 1) * sealedSize),
    )

    parts.push(new Uint8Array(plain))
  }

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0

  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }

  return out.buffer
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567"

/** Décode du base32 minuscule sans remplissage ; null si un caractère est hors alphabet. */
const base32 = (s: string): Uint8Array | null => {
  const out: number[] = []
  let bits = 0
  let acc = 0

  for (const c of s) {
    const v = B32.indexOf(c)

    if (v < 0) return null

    acc = (acc << 5) | v
    bits += 5

    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }

  return Uint8Array.from(out)
}

/**
 * Les octets correspondent-ils au CID ? Vérifié pour un CIDv1 raw sha2-256 (`bafkrei…`, ce que rend la station) ;
 * `null` pour toute autre forme (ancien `Qm…`, DAG Kubo) qu'on ne sait pas vérifier d'un bloc : à l'appelant de décider.
 * Une passerelle fautive ou hostile ne peut donc pas faire passer d'autres octets pour ceux de l'expéditeur.
 */
export const rawCidMatches = async (cid: string, bytes: Uint8Array): Promise<boolean | null> => {
  if (!cid.startsWith("b")) return null

  const decoded = base32(cid.slice(1))

  if (!decoded || decoded.length !== 4 + 32) return null
  if (decoded[0] !== 0x01 || decoded[1] !== 0x55 || decoded[2] !== 0x12 || decoded[3] !== 0x20) {
    return null
  }

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))

  return digest.every((b, i) => b === decoded[4 + i])
}

/** Origine https (ou http en local) sans identifiants ni chemin ; null sinon. */
export const gatewayOrigin = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null

  try {
    const u = new URL(raw)
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1"

    if (u.username || u.password) return null
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null

    return u.origin
  } catch {
    return null
  }
}

/** Passerelles à essayer, dans l'ordre : celles du message (valides, sans doublon), puis celle de l'application. */
export const gatewayCandidates = (hinted: unknown, fallback: string): string[] => {
  const list = Array.isArray(hinted) ? hinted : []
  const out: string[] = []

  for (const g of [...list.slice(0, 5), fallback]) {
    const o = gatewayOrigin(g)

    if (o && !out.includes(o)) out.push(o)
  }

  return out
}
