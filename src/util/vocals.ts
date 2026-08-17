/**
 * vocals.ts — Native voice message recording/upload/publish helpers.
 *
 * Replaces the old vocals-read.html iframe (UPassport) with a client-side
 * implementation of the same protocol:
 *   - kind 1222 (root voice message) / 1244 (reply, NIP-22-style e/p tags)
 *   - file upload via UPassport's /api/fileupload, which requires a NIP-42
 *     "local relay auth marker" — see authenticateForUpload()
 *   - optional NIP-44/NIP-04 encryption of the whole JSON content for a
 *     single recipient (private voice message)
 *
 * Tag conventions and auth flow reverse-engineered from:
 *   Astroport.ONE/tools/publish_nostr_vocal.sh
 *   UPassport/routers/media_upload.py (/api/fileupload)
 *   UPassport/services/nostr.py (require_nostr_auth / NIP-42 marker)
 *   UPassport/routers/geo.py (/api/nip42/challenge)
 *   UPlanet/earth/lib_2_api_connect.js (sendNIP42Auth)
 */
import type {TrustedEvent} from "@welshman/util"
import {getTagValue, makeEvent} from "@welshman/util"
import {pubkey, signer, publishThunk, waitForThunkCompletion, getThunkError} from "@welshman/app"
import {npubEncode} from "nostr-tools/nip19"
import {get} from "svelte/store"
import {sign} from "src/engine/state"
import {signAndPublish} from "src/engine/commands"
import {getVerifiedUPlanet} from "src/util/uplanet-detect"
import {resolveIpfsUrl} from "src/util/ipfs"

export const VOCAL_ROOT = 1222
export const VOCAL_REPLY = 1244
export const NIP42_AUTH_KIND = 22242

export interface VocalInfo {
  title: string
  url: string
  duration: number
  description: string
  latitude: string
  longitude: string
  isEncrypted: boolean
  encryptionMethod: "nip44" | "nip04" | ""
  isReply: boolean
  replyToId: string
  replyToPubkey: string
}

const findTag = (tags: string[][], keys: string[]) => {
  for (const key of keys) {
    const val = getTagValue(key, tags)
    if (val) return val
  }
  return ""
}

/** Extract display info from a kind 1222/1244 event's plaintext tags. */
export const extractVocalInfo = (event: TrustedEvent): VocalInfo => {
  const {tags} = event
  const replyTag = tags.find(t => t[0] === "e")

  return {
    title: findTag(tags, ["title"]),
    url: resolveIpfsUrl(findTag(tags, ["url"])),
    duration: parseFloat(findTag(tags, ["duration"]) || "0"),
    description: findTag(tags, ["description"]),
    latitude: findTag(tags, ["latitude"]),
    longitude: findTag(tags, ["longitude"]),
    isEncrypted: findTag(tags, ["encrypted"]) === "true",
    encryptionMethod: (findTag(tags, ["encryption"]) as "nip44" | "nip04") || "",
    isReply: event.kind === VOCAL_REPLY,
    replyToId: replyTag?.[1] || "",
    replyToPubkey:
      tags.find((t, i) => t[0] === "p" && i > (replyTag ? tags.indexOf(replyTag) : -1))?.[1] || "",
  }
}

/** Decrypted payload shape for a private (encrypted) vocal message. */
export interface VocalPayload {
  url: string
  duration: number
  title: string
  description?: string
  latitude?: string
  longitude?: string
}

/** Decrypt an encrypted vocal event's content — throws if not sender/recipient. */
export const decryptVocalContent = async (event: TrustedEvent): Promise<VocalPayload> => {
  const info = extractVocalInfo(event)
  const $signer = signer.get()
  if (!$signer) throw new Error("No signer available")

  const otherPubkey = event.pubkey === get(pubkey) ? getTagValue("p", event.tags) : event.pubkey
  if (!otherPubkey) throw new Error("No counterparty pubkey found on encrypted vocal event")

  const plaintext =
    info.encryptionMethod === "nip04"
      ? await $signer.nip04.decrypt(otherPubkey, event.content)
      : await $signer.nip44.decrypt(otherPubkey, event.content)

  return JSON.parse(plaintext)
}

const BEST_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
]

/** Best MediaRecorder mimeType supported by this browser. */
export const getBestAudioMimeType = (): string =>
  BEST_AUDIO_MIME_TYPES.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || "audio/webm"

/**
 * NIP-42 "local relay auth marker" dance required before /api/fileupload will
 * accept a request: fetch a challenge, sign+publish a kind 22242 event to the
 * station's own relay, whose write-policy plugin (filter/22242.sh) then
 * writes a marker file the HTTP API checks.
 */
export const authenticateForUpload = async (apiUrl: string, relayUrl: string): Promise<void> => {
  const npub = npubEncode(get(pubkey))

  const challengeRes = await fetch(`${apiUrl}/api/nip42/challenge?npub=${npub}`)
  if (!challengeRes.ok) {
    throw new Error("Impossible d'obtenir le challenge NIP-42")
  }
  const {challenge} = await challengeRes.json()

  const template = makeEvent(NIP42_AUTH_KIND, {
    tags: [
      ["relay", relayUrl],
      ["challenge", challenge],
    ],
  })
  const event = await sign(template)

  // publishThunk() returns a Thunk synchronously — the actual send to the
  // relay happens later via an internal batch queue (~100ms delay), so it
  // must be awaited explicitly. Without this, the upload below would race
  // ahead of the relay ever receiving the auth event, and the write-policy
  // plugin (filter/22242.sh) would never get a chance to write the marker
  // file that /api/fileupload checks.
  const thunk = publishThunk({event, relays: [relayUrl]})
  await waitForThunkCompletion(thunk)

  const error = getThunkError(thunk)
  if (error) {
    throw new Error(`Authentification NIP-42 refusée par le relais : ${error}`)
  }

  // The relay accepting the event and the write-policy plugin finishing its
  // file write are two separate steps — give it a brief moment to land.
  await new Promise(resolve => setTimeout(resolve, 500))
}

export interface UploadedVocal {
  cid: string
  fileHash: string
  mimeType: string
  duration: number
}

/** Upload a recorded/selected audio file, authenticating via NIP-42 first. */
export const uploadVocalAudio = async (file: File | Blob): Promise<UploadedVocal> => {
  const uplanet = getVerifiedUPlanet()
  if (!uplanet) {
    throw new Error("Aucune station UPlanet détectée")
  }

  await authenticateForUpload(uplanet.apiUrl, uplanet.relayUrl)

  const npub = npubEncode(get(pubkey))
  const formData = new FormData()
  formData.append("file", file, "vocal.webm")
  formData.append("npub", npub)

  const res = await fetch(`${uplanet.apiUrl}/api/fileupload`, {method: "POST", body: formData})

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("Envoi refusé : authentification NIP-42 requise")
    }
    throw new Error(`Échec de l'envoi (${res.status})`)
  }

  const data = await res.json()
  if (!data.new_cid) {
    throw new Error("Réponse d'upload invalide (CID manquant)")
  }

  return {
    cid: data.new_cid,
    fileHash: data.fileHash || "",
    mimeType: data.mimeType || "audio/webm",
    duration: data.duration || 0,
  }
}

export interface PublishVocalOptions {
  uploaded: UploadedVocal
  title: string
  description?: string
  duration: number
  latitude?: string
  longitude?: string
  /** When set, encrypts the payload for this single recipient (private message). */
  recipientPubkey?: string
  /** Reply-to context — publishes kind 1244 instead of 1222. */
  replyTo?: {id: string; pubkey: string; relay?: string}
}

/**
 * Build, sign and publish the final kind 1222/1244 event. Publishing goes
 * straight to the user's own relays (like any other coracle note) — the
 * relay write-policy has no dedicated filter for these kinds (just the
 * default blacklist check), so no server-side /vocals round-trip is needed.
 */
export const publishVocalMessage = async ({
  uploaded,
  title,
  description,
  duration,
  latitude,
  longitude,
  recipientPubkey,
  replyTo,
}: PublishVocalOptions) => {
  const url = `/ipfs/${uploaded.cid}/vocal.${uploaded.mimeType.split("/")[1] || "webm"}`
  const hasGeo = Boolean(latitude && longitude)

  const payload: VocalPayload = {
    url,
    duration,
    title,
    ...(description ? {description} : {}),
    ...(hasGeo ? {latitude, longitude} : {}),
  }

  const tags: string[][] = [
    ["title", title],
    ["url", url],
    ["duration", String(duration)],
  ]
  if (uploaded.fileHash) tags.push(["x", uploaded.fileHash])
  if (hasGeo) {
    tags.push(["g", `${latitude},${longitude}`], ["latitude", latitude!], ["longitude", longitude!])
  }

  let content = `🎤 ${title}`
  if (description) content += `\n📝 ${description}`

  if (recipientPubkey) {
    const $signer = signer.get()
    if (!$signer) throw new Error("No signer available")
    content = await $signer.nip44.encrypt(recipientPubkey, JSON.stringify(payload))
    tags.push(["encrypted", "true"], ["encryption", "nip44"], ["p", recipientPubkey])
  }

  if (replyTo) {
    tags.push(["e", replyTo.id, replyTo.relay || "", "reply"], ["p", replyTo.pubkey])
  }

  const template = makeEvent(replyTo ? VOCAL_REPLY : VOCAL_ROOT, {content, tags})

  return signAndPublish(template)
}
