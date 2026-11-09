/**
 * uenc.ts — pièces jointes chiffrées des messages privés (format UENC v1, partagé avec
 * Astroport.ONE/tools/uenc_codec.py et zelkova) : `UENC` + version(1) + type(1) + IV(12) + chiffré+étiquette,
 * AES-256-GCM. Le chiffrement se fait ICI : la station ne reçoit que des octets illisibles et ne connaît pas la clé.
 */
import {bytesToHex, hexToBytes} from "@welshman/lib"

const MAGIC = [0x55, 0x45, 0x4e, 0x43] // "UENC"
const VERSION = 1
const AES256GCM = 1
const HEADER = 6
const IV_LEN = 12

export type EncryptedAttachment = {payload: Uint8Array; keyHex: string; ivHex: string}

export const encryptUenc = async (data: ArrayBuffer): Promise<EncryptedAttachment> => {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, data))
  const payload = new Uint8Array(HEADER + IV_LEN + sealed.length)

  payload.set(MAGIC, 0)
  payload[4] = VERSION
  payload[5] = AES256GCM
  payload.set(iv, HEADER)
  payload.set(sealed, HEADER + IV_LEN)

  return {payload, keyHex: bytesToHex(raw), ivHex: bytesToHex(iv)}
}

/** L'IV est lu dans l'en-tête (comme bro_dm_daemon.sh), pas dans le message. */
export const decryptUenc = async (bytes: Uint8Array, keyHex: string): Promise<ArrayBuffer> => {
  if (
    bytes.length < HEADER + IV_LEN + 16 ||
    !MAGIC.every((b, i) => bytes[i] === b) ||
    bytes[4] !== VERSION ||
    bytes[5] !== AES256GCM
  ) {
    throw new Error("Invalid UENC payload")
  }

  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, [
    "decrypt",
  ])

  return crypto.subtle.decrypt(
    {name: "AES-GCM", iv: bytes.slice(HEADER, HEADER + IV_LEN)},
    key,
    bytes.slice(HEADER + IV_LEN),
  )
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
