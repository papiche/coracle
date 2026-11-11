// UPlanet's BRO/NODE scripts (Astroport.ONE's nostr_node_intercom.py) wrap DM
// content in a JSON envelope {"channel": "...", "payload": {...}} instead of
// plain text. BRO (the AI assistant) and NODE (the station) sign with the same
// key, distinguished only by the envelope's "channel" field — see
// Astroport.ONE/docs/reference/IDENTITY_MULTIPASS.md.

import {bytesToHex} from "@welshman/lib"
import {getIpfsGateway} from "src/util/ipfs"
import {nip98Header} from "src/util/nip98"
import {getVerifiedUPlanet} from "src/util/uplanet-detect"
import {
  decryptUenc,
  encryptUenc,
  gatewayCandidates,
  gatewayOrigin,
  rawCidMatches,
} from "src/util/uenc"

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
// /api/fileupload/encrypted (UENC v2: magic "UENC"(4) + version(1) + enc_type(1) + chunk_log2(1) + nonce prefix(7), then 64 KiB sealed chunks).

export type UencImgEnvelope = {
  cid: string
  encKey: string
  iv: string
  filename: string
  hint?: string
  /** Passerelles où le chiffré se trouve (adresses de stations) ; facultatif, ignoré des anciens clients. */
  gw?: string[]
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
        gw: Array.isArray(img.gw) ? img.gw.map(gatewayOrigin).filter(Boolean) : undefined,
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

  // Station astroportd : le fichier est chiffré ICI (la station ne reçoit que des octets illisibles et ne connaît
  // pas la clé), puis déposé comme pièce jointe, adressée par son contenu (CID).
  if (up.astroportd) return uploadToAstroportd(up.apiUrl, file)

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

const uploadToAstroportd = async (apiUrl: string, file: File): Promise<UencImgEnvelope> => {
  const {payload, keyHex, ivHex} = await encryptUenc(await file.arrayBuffer())
  const url = `${apiUrl.replace(/\/$/, "")}/api/v1/attachments?days=30`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Authorization: await nip98Header(url, "POST"),
    },
    body: payload,
  })
  const data = await res.json().catch(() => null)

  if (!res.ok || !data?.cid) {
    throw new Error(
      `Encrypted upload failed: ${data?.error || data?.message || `HTTP ${res.status}`}`,
    )
  }

  return {
    cid: data.cid,
    encKey: keyHex,
    iv: ivHex,
    filename: file.name,
    gw: [data.gateway].filter(Boolean),
  }
}

const guessImageMime = (filename: string) => {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "png") return "image/png"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  return "image/jpeg"
}

/**
 * Fetch + decrypt a _uenc_img. Returns an object URL for <img src>.
 * Les passerelles du message sont essayées d'abord, puis celle de l'application : l'adresse est un contenu (CID), pas une
 * machine. Pour un CIDv1 raw, les octets reçus sont vérifiés contre le CID avant tout déchiffrement. Les requêtes
 * n'envoient ni cookie ni référent.
 */
export const decryptUencImage = async (envelope: UencImgEnvelope): Promise<string> => {
  let failure = "no gateway"

  for (const gw of gatewayCandidates(envelope.gw, getIpfsGateway())) {
    try {
      const res = await fetch(`${gw}/ipfs/${encodeURIComponent(envelope.cid)}`, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
      })

      if (!res.ok) {
        failure = `HTTP ${res.status}`
        continue
      }

      const bytes = new Uint8Array(await res.arrayBuffer())

      if ((await rawCidMatches(envelope.cid, bytes)) === false) {
        failure = "content does not match its CID"
        continue
      }

      const plaintext = await decryptUenc(bytes, envelope.encKey)

      return URL.createObjectURL(new Blob([plaintext], {type: guessImageMime(envelope.filename)}))
    } catch (err: any) {
      failure = err?.message || String(err)
    }
  }

  throw new Error(`IPFS fetch failed: ${failure}`)
}
