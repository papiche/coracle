/**
 * Visio vdo.ninja UPlanet — état et réseau (présence kind 24315, sonnerie kind 24316, appel).
 * Logique pure : src/util/visio.ts. Spécification : NIP-101/KIND_REGISTRY.md.
 *
 * Légèreté : rien ne tourne tant que le membre n'a pas activé « Visio : être joignable »
 * (Réglages) ; aucune connexion de plus (les abonnements passent par le pool de relais déjà
 * ouvert) ; l'iframe vdo.ninja n'existe qu'au moment où l'on rejoint une salle.
 *
 * Confidentialité : le relais voit QUI signale sa présence à QUI (mêmes métadonnées qu'un
 * message privé) — d'où l'opt-in et la limite aux amis MUTUELS (je les suis ET ils me suivent).
 * On ne déchiffre jamais une sonnerie d'un autre que ces amis.
 */
import {derived, get, writable} from "svelte/store"
import {getFollowers, getFollows, pubkey, repository, signer, tagPubkey} from "@welshman/app"
import {Router} from "@welshman/router"
import {DIRECT_MESSAGE, DEPRECATED_DIRECT_MESSAGE, makeEvent} from "@welshman/util"
import type {TrustedEvent} from "@welshman/util"
import {ensureMessagePlaintext, myRequest} from "src/engine/state"
import {sendMessage, signAndPublish} from "src/engine/commands"
import {
  PRESENCE_KIND,
  PRESENCE_STATUSES,
  RING_KIND,
  createVisioRoom,
  encodeInvite,
  parseInvite,
  presenceOf,
} from "src/util/visio"
import type {PresenceStatus, VisioInvite, VisioRoom} from "src/util/visio"

const STORAGE_KEY = "uplanet.presence"
const HEARTBEAT_MS = 4 * 60 * 1000
const MAX_P_TAGS = 50
const RECENT_DM_SECONDS = 5 * 60

const readEnabled = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

/** Opt-in (par navigateur) : être vu en ligne par ses amis mutuels et recevoir leurs appels en direct. */
export const presenceEnabled = writable<boolean>(readEnabled())

presenceEnabled.subscribe($enabled => {
  try {
    if ($enabled) localStorage.setItem(STORAGE_KEY, "1")
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // stockage indisponible : le choix vaut pour cette session seulement
  }
})

export const presences = writable<Record<string, {status: PresenceStatus; at: number}>>({})

/** État de présence d'un ami (« offline » si le dernier battement a plus de 6 minutes). */
export const derivePresence = (peer: string) =>
  derived(presences, $presences => presenceOf($presences[peer]))

/** Salle ouverte dans le panneau flottant (jamais dans l'URL : elle contient le mot de passe). */
export const activeVisio = writable<{room: VisioRoom; label: string} | null>(null)

/** Invitation reçue en direct, en attente de « Rejoindre / Ignorer ». */
export const incomingInvite = writable<{invite: VisioInvite; from: string} | null>(null)

export const openVisio = (room: VisioRoom, label = "") => {
  activeVisio.set({room, label})
  void publishPresence("visio")
}

export const closeVisio = () => {
  activeVisio.set(null)
  void publishPresence(document.hidden ? "away" : "online")
}

/** Amis mutuels : je les suis ET ils me suivent (listes de suivi déjà chargées par l'application). */
export const getMutualFollows = (me = pubkey.get()): string[] => {
  if (!me) return []

  const followers = new Set(getFollowers(me))

  return getFollows(me).filter(p => p !== me && followers.has(p))
}

export const isMutualFollow = (peer: string) => getMutualFollows().includes(peer)

// ── Présence ─────────────────────────────────────────────────────────────────────────────────

export const publishPresence = async (status: PresenceStatus) => {
  if (!get(presenceEnabled) || !pubkey.get()) return

  const friends = getMutualFollows().slice(0, MAX_P_TAGS)

  if (!friends.length) return

  await signAndPublish(
    makeEvent(PRESENCE_KIND, {tags: [...friends.map(p => ["p", p]), ["status", status]]}),
  )
}

const currentStatus = (): PresenceStatus =>
  get(activeVisio) ? "visio" : document.hidden ? "away" : "online"

// ── Sonnerie et invitations ──────────────────────────────────────────────────────────────────

const seen = new Set<string>()

const ring = async (peer: string, text: string) => {
  const content = await signer.get().nip44.encrypt(peer, text)

  await signAndPublish(makeEvent(RING_KIND, {content, tags: [tagPubkey(peer)]}))
}

/**
 * Un texte déchiffré (message privé ou sonnerie) : si c'est une invitation fraîche d'un ami
 * mutuel, elle devient `incomingInvite`. Un message d'un autre expéditeur reste un message
 * ordinaire — pas d'appel surprise. Dédoublonné par événement ET par salle (la sonnerie et le
 * message privé portent la même salle).
 */
export const handleInviteText = (from: string, text: string, id?: string): boolean => {
  const invite = parseInvite(text)

  if (!invite || from === pubkey.get()) return false
  if ((id && seen.has(id)) || seen.has("room:" + invite.room)) return false
  if (!isMutualFollow(from)) return false

  if (id) seen.add(id)
  seen.add("room:" + invite.room)
  incomingInvite.set({invite, from})

  return true
}

/**
 * Appelle `peer` depuis sa conversation `channelId` : salle privée → sonnerie éphémère si l'ami est
 * en ligne ET message d'invitation dans le fil (trace durable, chiffré comme les autres messages)
 * → ouverture de la salle. La sonnerie est un bonus : son échec ne bloque jamais l'appel.
 */
export const callPerson = async (channelId: string, peer: string, label = "") => {
  const room = await createVisioRoom()
  const text = encodeInvite(room, pubkey.get())
  let rang = false

  if (presenceOf(get(presences)[peer]) !== "offline") {
    try {
      await ring(peer, text)
      rang = true
    } catch {
      // le message privé ci-dessous prévient quand même l'ami
    }
  }

  await sendMessage(channelId, text, 0)
  openVisio(room, label)

  return rang ? "ring+dm" : "dm"
}

// ── Services (abonnements + battement), actifs seulement si l'opt-in est donné ───────────────

const startServices = () => {
  const me = pubkey.get()
  const controller = new AbortController()
  const since = Math.floor(Date.now() / 1000) - 30

  myRequest({
    skipCache: true,
    signal: controller.signal,
    relays: Router.get().ForUser().getUrls(),
    filters: [{kinds: [PRESENCE_KIND, RING_KIND], "#p": [me], since}],
    onEvent: async (e: TrustedEvent) => {
      if (!isMutualFollow(e.pubkey)) return // seuls les amis mutuels comptent, avant tout déchiffrement

      if (e.kind === PRESENCE_KIND) {
        const status = e.tags.find(t => t[0] === "status")?.[1] as PresenceStatus

        if (!PRESENCE_STATUSES.includes(status)) return

        presences.update($p =>
          $p[e.pubkey] && $p[e.pubkey].at > e.created_at
            ? $p
            : {...$p, [e.pubkey]: {status, at: e.created_at}},
        )
      } else if (e.kind === RING_KIND) {
        try {
          handleInviteText(e.pubkey, await signer.get().nip44.decrypt(e.pubkey, e.content), e.id)
        } catch {
          // illisible : ignorée
        }
      }
    },
  })

  // Invitation reçue par message privé (ami hors ligne, ou sonnerie ratée) : déchiffrée par l'appli
  // pour afficher la conversation, on la regarde au passage.
  const onUpdate = async ({added}: {added: TrustedEvent[]}) => {
    const now = Math.floor(Date.now() / 1000)

    for (const e of added) {
      if (e.pubkey === me || now - e.created_at > RECENT_DM_SECONDS) continue
      if (e.kind !== DIRECT_MESSAGE && e.kind !== DEPRECATED_DIRECT_MESSAGE) continue

      try {
        const text =
          e.kind === DEPRECATED_DIRECT_MESSAGE ? await ensureMessagePlaintext(e) : e.content

        if (text) handleInviteText(e.pubkey, text, e.id)
      } catch {
        // pas déchiffrable : rien à faire
      }
    }
  }

  repository.on("update", onUpdate)

  const beat = () => void publishPresence(currentStatus())
  const timer = setInterval(beat, HEARTBEAT_MS)

  document.addEventListener("visibilitychange", beat)
  window.addEventListener("pagehide", onPageHide)
  beat()

  return () => {
    controller.abort()
    repository.off("update", onUpdate)
    clearInterval(timer)
    document.removeEventListener("visibilitychange", beat)
    window.removeEventListener("pagehide", onPageHide)
    void publishPresence("offline")
  }
}

const onPageHide = () => void publishPresence("offline")

/**
 * À appeler une fois (App.svelte). Démarre/arrête les services quand l'utilisateur se (dé)connecte ou
 * bascule l'opt-in. Retourne la fonction d'arrêt.
 */
export const startVisioServices = () => {
  let stop: (() => void) | null = null

  const unsubscribe = derived([pubkey, presenceEnabled], ([$pubkey, $enabled]) =>
    Boolean($pubkey && $enabled),
  ).subscribe(active => {
    if (active && !stop) stop = startServices()
    if (!active && stop) {
      stop()
      stop = null
    }
  })

  return () => {
    unsubscribe()
    stop?.()
    stop = null
  }
}
