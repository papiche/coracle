/**
 * Visio vdo.ninja UPlanet — logique pure (aucun état, aucun réseau hors `createVisioRoom`).
 *
 * Même contrat que UPlanet/earth/visio.js ; spécification : NIP-101/KIND_REGISTRY.md
 * (kinds 24315 présence, 24316 sonnerie, section « Visio vdo.ninja »).
 *
 *  - Salle ET mot de passe sont tirés au sort par la station (POST /api/visio/room, NIP-98) :
 *    plus de salle dérivée d'une clé publique (devinable, sans mot de passe).
 *  - Une invitation est un petit JSON `uplanet.visio` envoyé dans un message privé chiffré
 *    (ou une sonnerie éphémère kind 24316 chiffrée NIP-44). On la valide strictement : un
 *    expéditeur ne doit pas pouvoir nous faire ouvrir une adresse arbitraire.
 */
export const PRESENCE_KIND = 24315
export const RING_KIND = 24316
export const INVITE_TYPE = "uplanet.visio"
export const MAX_INVITE_AGE = 24 * 3600

export type VisioRoom = {
  room: string
  password: string
  base: string
  expires_at: number
}

export type VisioInvite = VisioRoom & {from?: string}

export type PresenceStatus = "online" | "visio" | "away" | "offline"

export const PRESENCE_STATUSES: PresenceStatus[] = ["online", "visio", "away", "offline"]

const ROOM_RE = /^[0-9a-f]{20}$/
const PASSWORD_RE = /^[0-9a-f]{16}$/
const BASE_RE = /^https:\/\/[^\s/]+$/

/**
 * Lien vdo.ninja d'une salle (paramètres vérifiés dans docs.vdo.ninja ET sur l'instance réelle) :
 *  - `call` (défaut) : salle + mot de passe, SANS autostart — le visiteur choisit caméra/micro lui-même ;
 *  - `studio` (live) : + enregistrement, effets, démarrage immédiat (réservé à qui a cliqué « Démarrer ») ;
 *  - `view` : spectateur = `&scene` (tous les participants, sans publier) + `&cleanoutput`.
 * Un `&view` nu signifie « ne reçois aucun flux » : ce n'est PAS un lien spectateur.
 * Le mot de passe va dans le FRAGMENT (`#p=`), jamais envoyé au serveur ni aux journaux du proxy.
 */
export const buildVisioUrl = (
  room: VisioRoom,
  {role = "call", label = ""}: {role?: "call" | "studio" | "view"; label?: string} = {},
) => {
  const q = `?room=${encodeURIComponent(room.room)}`
  const frag = `#p=${encodeURIComponent(room.password)}`
  const name = label ? `&label=${encodeURIComponent(label.slice(0, 30))}` : ""

  if (role === "view") return `${room.base}/${q}&scene&cleanoutput${frag}`
  if (role === "studio") return `${room.base}/${q}&record${name}&autostart${frag}`

  return `${room.base}/${q}${name}${frag}`
}

export const encodeInvite = (room: VisioRoom, from?: string) =>
  JSON.stringify({
    t: INVITE_TYPE,
    v: 1,
    room: room.room,
    pw: room.password,
    base: room.base,
    exp: room.expires_at,
    ...(from ? {from} : {}),
  })

/**
 * Le texte EST-il une invitation ? (même périmée : l'écran de conversation l'affiche alors
 * « expirée » au lieu de montrer du JSON brut.) `null` si ce n'est pas une invitation valide.
 */
export const inspectInvite = (
  text: string | undefined | null,
  now = Math.floor(Date.now() / 1000),
): {invite: VisioInvite; expired: boolean} | null => {
  if (!text || text[0] !== "{") return null

  try {
    const d = JSON.parse(text)

    if (!d || d.t !== INVITE_TYPE || d.v !== 1) return null
    if (
      !ROOM_RE.test(d.room || "") ||
      !PASSWORD_RE.test(d.pw || "") ||
      !BASE_RE.test(d.base || "")
    ) {
      return null
    }
    if (typeof d.exp !== "number") return null

    return {
      invite: {room: d.room, password: d.pw, base: d.base, expires_at: d.exp, from: d.from},
      expired: d.exp < now || d.exp > now + MAX_INVITE_AGE + 3600,
    }
  } catch {
    return null
  }
}

/** Invitation valide ET non périmée, sinon null. */
export const parseInvite = (text: string | undefined | null, now?: number): VisioInvite | null => {
  const found = inspectInvite(text, now)

  return found && !found.expired ? found.invite : null
}

/** Salle privée tirée au sort par la station (NIP-98). Lève avec le message du serveur. */
export const createVisioRoom = async (ttl?: number): Promise<VisioRoom> => {
  // Imports tardifs : ce module reste pur (testable sans charger l'état de l'application).
  const [{nip98Header}, {resolveApiUrl}] = await Promise.all([
    import("src/util/nip98"),
    import("src/util/uplanet-detect"),
  ])
  const url = `${(await resolveApiUrl()).replace(/\/$/, "")}/api/visio/room`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: await nip98Header(url, "POST"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(ttl ? {ttl} : {}),
  })

  let data: any = null

  try {
    data = await res.json()
  } catch {
    // corps illisible : le statut HTTP suffit
  }

  if (!res.ok) {
    throw new Error(
      `Salle de visio non créée — ${data?.detail || data?.error?.message || `HTTP ${res.status}`}`,
    )
  }

  return data as VisioRoom
}

/** Un battement de présence est « frais » 6 minutes (le client émet toutes les 4). */
export const PRESENCE_FRESH_SECONDS = 6 * 60

export const presenceOf = (
  entry: {status: PresenceStatus; at: number} | undefined,
  now = Math.floor(Date.now() / 1000),
): PresenceStatus => (entry && now - entry.at <= PRESENCE_FRESH_SECONDS ? entry.status : "offline")
