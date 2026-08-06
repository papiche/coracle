// UPlanet's BRO/NODE scripts (Astroport.ONE's nostr_node_intercom.py) wrap DM
// content in a JSON envelope {"channel": "...", "payload": {...}} instead of
// plain text. BRO (the AI assistant) and NODE (the station) sign with the same
// key, distinguished only by the envelope's "channel" field — see
// Astroport.ONE/docs/reference/IDENTITY_MULTIPASS.md.

import {bytesToHex, hexToBytes} from "@welshman/lib"
import {getIpfsGateway} from "src/util/ipfs"
import {getVerifiedUPlanet} from "src/util/uplanet-detect"

export type UplanetEnvelope = {
  channel: string
  payload: Record<string, any>
}

const BRO_CHANNELS = new Set(["bro_ia"])

export const parseUplanetEnvelope = (content: string): UplanetEnvelope | null => {
  try {
    const data = JSON.parse(content)

    if (
      data &&
      typeof data.channel === "string" &&
      data.payload &&
      typeof data.payload === "object"
    ) {
      return data as UplanetEnvelope
    }
  } catch (err) {
    // not a UPlanet envelope — plain nostr message
  }

  return null
}

export const displayUplanetChannel = (channel: string) =>
  BRO_CHANNELS.has(channel) ? "BRO" : "NODE"

export const displayUplanetPayload = (payload: Record<string, any>) =>
  typeof payload.text === "string" ? payload.text : JSON.stringify(payload)

// ── Encrypted DM images (_uenc_img) ──────────────────────────────────────────
// Wire format used by bro_dm_daemon.sh (_handle_bro_image, IA/bro/bro_dm_daemon.sh:385-435)
// and atomic_chat.html/Zelkova: the plaintext DM content (itself NIP-44/04
// encrypted end-to-end) is a JSON object {"_uenc_img": {cid, enc_key, iv, filename, hint}}.
// The file itself sits on IPFS pre-encrypted with AES-256-GCM by UPassport's
// /api/fileupload/encrypted (UENC format: magic"UENC"(4) + version(1) + enc_type(1) + iv(12) + ciphertext+tag).

export type UencImgEnvelope = {
  cid: string
  encKey: string
  iv: string
  filename: string
  hint?: string
}

export const parseUencImgEnvelope = (content: string): UencImgEnvelope | null => {
  try {
    const data = JSON.parse(content)
    const img = data?._uenc_img

    if (img && typeof img.cid === "string" && typeof img.enc_key === "string") {
      return {
        cid: img.cid,
        encKey: img.enc_key,
        iv: img.iv || "",
        filename: img.filename || "image.jpg",
        hint: img.hint || "",
      }
    }
  } catch (err) {
    // not a _uenc_img envelope
  }

  return null
}

/** Upload + AES-256-GCM encrypt an image via UPassport, ready to embed in a DM. */
export const uploadEncryptedImage = async (file: File): Promise<UencImgEnvelope> => {
  const up = getVerifiedUPlanet()
  if (!up)
    throw new Error("UPlanet API unavailable — encrypted DM images require a UPlanet gateway")

  const encKey = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))

  const formData = new FormData()
  formData.append("file", file)
  formData.append("encryption_key", encKey)
  formData.append("encryption_type", "aes256gcm")

  const res = await fetch(`${up.apiUrl}/api/fileupload/encrypted`, {method: "POST", body: formData})
  if (!res.ok) throw new Error(`Encrypted upload failed: HTTP ${res.status}`)

  const data = await res.json()
  if (!data.success || !data.cid) throw new Error("Encrypted upload failed: invalid response")

  return {
    cid: data.cid,
    encKey,
    iv: data.iv_hex || "",
    filename: data.original_filename || file.name,
  }
}

const UENC_MAGIC = "UENC"

const guessImageMime = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "png") return "image/png"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  return "image/jpeg"
}

/**
 * Fetch + decrypt a _uenc_img from IPFS. Returns an object URL for <img src>.
 * The IV is read from the UENC file header (bytes 6-18), not from the JSON
 * envelope's "iv" field — matching bro_dm_daemon.sh, which does the same.
 */
export const decryptUencImage = async (envelope: UencImgEnvelope): Promise<string> => {
  const res = await fetch(`${getIpfsGateway()}/ipfs/${envelope.cid}`)
  if (!res.ok) throw new Error(`IPFS fetch failed: HTTP ${res.status}`)

  const bytes = new Uint8Array(await res.arrayBuffer())
  const magic = new TextDecoder().decode(bytes.slice(0, 4))

  if (bytes.length < 18 || magic !== UENC_MAGIC) {
    throw new Error("Invalid UENC payload")
  }

  const iv = bytes.slice(6, 18)
  const ciphertext = bytes.slice(18)
  const key = await crypto.subtle.importKey("raw", hexToBytes(envelope.encKey), "AES-GCM", false, [
    "decrypt",
  ])
  const plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, ciphertext)

  return URL.createObjectURL(new Blob([plaintext], {type: guessImageMime(envelope.filename)}))
}
