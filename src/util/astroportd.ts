// Station astroportd (démon Rust qui remplace Astroport.ONE) : un seul hôte/port porte le relai
// Nostr (WebSocket à la racine), l'API `/api/v1/*` et `/12345`. Les conventions historiques
// (relay.<domaine> <-> u.<domaine>, 7777 <-> 54321) n'y valent pas. Ce module ne contient que de
// la logique pure ou autonome (aucun store, aucune dépendance applicative) pour rester testable.

/** `wss://hôte[:port]` -> `https://hôte[:port]` (ws -> http). null si ce n'est pas un URL ws(s). */
export const sameHostApiUrl = (relayUrl: string): string | null => {
  try {
    const url = new URL(relayUrl)

    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null

    return `${url.protocol === "wss:" ? "https" : "http"}://${url.host}`
  } catch {
    return null
  }
}

/** L'URL d'API suit-elle la convention historique (u.<domaine> ou port 54321) ? Alors pas de sonde. */
export const followsLegacyApiConvention = (apiUrl: string): boolean => {
  try {
    const url = new URL(apiUrl)

    return url.hostname.startsWith("u.") || url.port === "54321"
  } catch {
    return false
  }
}

/** Le JSON de `/12345` est-il celui d'un astroportd ? */
export const isAstroportdState = (data: unknown): boolean =>
  Boolean(data) && typeof data === "object" && (data as any)._source === "astroportd"

const _known = new Map<string, boolean>()

/** Verdict déjà connu pour cette URL d'API (true/false), ou undefined si jamais sondée. */
export const knownAstroportd = (apiUrl: string): boolean | undefined =>
  _known.get(apiUrl.replace(/\/$/, ""))

/**
 * GET {apiUrl}/12345 : `_source === "astroportd"`. Le verdict (positif ou négatif) est mis en
 * cache ; une erreur réseau n'est PAS mise en cache. Ne sonde qu'une URL fournie par l'appelant
 * (relai choisi par l'utilisateur, station choisie) : jamais d'hôte arbitraire.
 */
export const probeAstroportd = async (
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> => {
  const base = apiUrl.replace(/\/$/, "")
  const known = _known.get(base)

  if (known !== undefined) return known

  try {
    const res = await fetchImpl(`${base}/12345`, {
      headers: {Accept: "application/json"},
      signal: AbortSignal.timeout(3000),
    })
    const ok = res.ok && isAstroportdState(await res.json().catch(() => null))

    _known.set(base, ok)

    return ok
  } catch {
    return false
  }
}

/** Seulement pour les tests. */
export const _resetAstroportdCache = () => _known.clear()

/** Corps réel de POST /api/v1/account/unlock (UnlockBody : email, pass). */
export const unlockBody = (email: string, pass: string) => ({email: email.trim(), pass})

/** Corps réel de POST /api/v1/account/keys (KeysBody : confirm explicite). */
export const keysBody = () => ({confirm: true})

/** En-tête Basic `email:jeton` (identifiants ASCII : e-mail et jeton rendus par la station). */
export const basicHeader = (email: string, token: string) => "Basic " + btoa(`${email}:${token}`)

/**
 * Erreur d'unlock/keys ({error, code}) -> code existant, d'après le code stable du serveur
 * (jamais le texte) : pass_denied -> INVALID_PASS ; pass_locked -> INVALID_PASS + locked ;
 * rate_limited et tout le reste -> UNKNOWN. Le message affiché est celui du serveur.
 */
export const mapUnlockError = (
  data: any,
): {code: "INVALID_PASS" | "UNKNOWN"; message?: string; locked: boolean} => {
  const message = typeof data?.error === "string" ? data.error : undefined

  if (data?.code === "pass_denied") return {code: "INVALID_PASS", message, locked: false}
  if (data?.code === "pass_locked") return {code: "INVALID_PASS", message, locked: true}

  return {code: "UNKNOWN", message, locked: false}
}

/** Réponse unlock {email, hex, token, guest} + keys {nsec, npub, dunikey?} -> résultat (sans secret en plus). */
export const fromUnlockAndKeys = (unlock: any, keys: any, pass: string) => {
  if (typeof keys?.nsec !== "string" || !keys.nsec) return null
  if (typeof keys?.npub !== "string" || typeof unlock?.hex !== "string") return null

  return {
    email: typeof unlock.email === "string" ? unlock.email : "",
    nsec: keys.nsec as string,
    npub: keys.npub as string,
    hex: unlock.hex as string,
    pass,
    // Ni g1pub ni nostrns ne sont rendus par ces deux routes : laissés absents.
    g1pub: undefined as string | undefined,
  }
}

/**
 * En-têtes d'authentification d'un envoi d'image : NIP-98 (méthode POST, URL complète, SANS tag
 * payload : le multipart est construit par le navigateur) sur une station astroportd confirmée,
 * rien ailleurs (stations historiques : requête inchangée). `nip98Header` est injecté.
 */
export const uploadAuthHeaders = async (
  services: {uploadUrl: string; astroportd?: boolean},
  nip98Header: (url: string, method: string) => Promise<string>,
): Promise<Record<string, string>> =>
  services.astroportd ? {Authorization: await nip98Header(services.uploadUrl, "POST")} : {}

/** zen_cents (entiers, centimes de Ẑen) -> Ẑen entiers ; null si le champ est absent ou invalide. */
export const zenFromCents = (zenCents: unknown): number | null =>
  typeof zenCents === "number" && Number.isSafeInteger(zenCents) && zenCents >= 0
    ? Math.floor(zenCents / 100)
    : null

/** Corps réel de POST /api/v1/feedback ; la clé publique n'est jointe que si share_identity est vrai. */
export const feedbackBody = (f: {
  title: string
  description: string
  appVersion?: string
  shareIdentity: boolean
}) => ({
  title: f.title,
  description: f.description,
  source: "coracle",
  category: "bug",
  platform: "web",
  ...(f.appVersion ? {app_version: f.appVersion} : {}),
  share_identity: f.shareIdentity === true,
})

/** Statut/code d'erreur de /api/v1/feedback -> clé de traduction ; null = message générique. */
export const feedbackErrorKey = (status: number, data: any): string | null =>
  status === 401
    ? "feedbackCreate.authRequired"
    : status === 429 && data?.code === "rate_limited"
      ? "feedbackCreate.rateLimited"
      : null

/** Conversation de la station avec `peer` (64 hex), d'où l'appel visio de la station se lance ; null si invalide. */
export const stationChatUrl = (apiUrl: string, peer: string): string | null =>
  /^[0-9a-f]{64}$/.test(peer) ? `${apiUrl.replace(/\/$/, "")}/#/chat?peer=${peer}` : null
