/**
 * NIP-98 (HTTP Auth) — signe une requête vers l'API de la station UPlanet (UPassport).
 *
 * Une seule signature, sans état, valable sur n'importe quelle station : c'est ce qui
 * permet le roaming sans la danse NIP-42 (défi → kind 22242 publié sur le relais →
 * marqueur d'1 h) de `authenticateForUpload` (vocals.ts), qui reste pour les routes
 * historiques (/api/fileupload…).
 *
 * L'événement lie la méthode et l'URL de la requête (le serveur compare méthode et chemin)
 * et porte un `nonce` aléatoire : même route, même seconde, deux signatures distinctes.
 */
import {makeEvent} from "@welshman/util"
import {sign} from "src/engine/state"

export const HTTP_AUTH_KIND = 27235

const base64url = (text: string) =>
  btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const nonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join(
    "",
  )

/** Valeur de l'en-tête `Authorization` pour `method` + `url` (URL absolue de la requête). */
export const nip98Header = async (url: string, method: string): Promise<string> => {
  const event = await sign(
    makeEvent(HTTP_AUTH_KIND, {
      tags: [
        ["u", url],
        ["method", method.toUpperCase()],
        ["nonce", nonce()],
      ],
    }),
  )

  return "Nostr " + base64url(JSON.stringify(event))
}
