// StorageProvider for @welshman/store's sync({key: "sessions", ...}): identical
// to localStorageProvider for every session, except a nip01 session's raw
// `secret` is split out into the OS-keystore-backed secure storage plugin
// (Android Keystore / iOS Keychain; a base64 localStorage shim on plain web,
// same security level coracle already had) instead of landing in plaintext
// localStorage — the only session method that ever holds a raw private key.
import {SecureStoragePlugin} from "capacitor-secure-storage-plugin"
import type {StorageProvider} from "@welshman/store"
import logger from "src/util/logger"

const SECRET_KEY_PREFIX = "nip01-secret-"

const getJson = (key: string) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "")
  } catch {
    return undefined
  }
}

const setJson = (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value))

export const secureSessionStorage: StorageProvider = {
  get: async (key: string) => {
    const sessions = getJson(key)
    if (!sessions) return sessions

    for (const [sessionPubkey, session] of Object.entries(sessions) as [string, any][]) {
      if (session?.method !== "nip01") continue

      try {
        const {value} = await SecureStoragePlugin.get({key: SECRET_KEY_PREFIX + sessionPubkey})
        session.secret = value
      } catch (err) {
        // Secret missing from secure storage (e.g. app data cleared, or a
        // localStorage backup restored without it) — drop the broken session
        // rather than logging in with no signing key.
        logger.warn("[secureSessionStorage] Missing secret for session, dropping it:", err)
        delete sessions[sessionPubkey]
      }
    }

    return sessions
  },
  set: async (key: string, value: Record<string, any>) => {
    const sanitized: Record<string, any> = {}

    for (const [sessionPubkey, session] of Object.entries(value)) {
      if (session?.method === "nip01") {
        const {secret, ...rest} = session
        await SecureStoragePlugin.set({key: SECRET_KEY_PREFIX + sessionPubkey, value: secret})
        sanitized[sessionPubkey] = rest
      } else {
        sanitized[sessionPubkey] = session
      }
    }

    setJson(key, sanitized)
  },
}
