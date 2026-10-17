import {describe, expect, it} from "vitest"
import {buildVisioUrl, encodeInvite, inspectInvite, parseInvite, presenceOf} from "src/util/visio"

const room = {
  room: "a".repeat(20),
  password: "b".repeat(16),
  base: "https://vdo.example.org",
  expires_at: 2_000_000_000,
}
const now = 1_999_999_000

describe("buildVisioUrl (paramètres vérifiés sur docs.vdo.ninja et l'instance réelle)", () => {
  it("appel : salle + mot de passe en fragment, sans autostart", () => {
    const url = buildVisioUrl(room, {label: "Alice"})

    expect(url).toBe(`https://vdo.example.org/?room=${room.room}&label=Alice#p=${room.password}`)
    expect(url).not.toContain("autostart")
    expect(new URL(url).search).not.toContain(room.password) // le secret n'est jamais envoyé au serveur
  })

  it("spectateur : &scene (et surtout pas un &view nu, qui ne reçoit aucun flux)", () => {
    const url = buildVisioUrl(room, {role: "view"})

    expect(url).toContain("&scene&cleanoutput")
    expect(url).not.toMatch(/[?&]view\b/)
  })

  it("studio : enregistrement et démarrage immédiat, partage d'écran conservé", () => {
    const url = buildVisioUrl(room, {role: "studio", label: "Alice"})

    expect(url).toContain("&record")
    expect(url).toContain("&autostart")
    expect(url).not.toContain("webcam")
  })

  it("le libellé est borné et encodé", () => {
    expect(buildVisioUrl(room, {label: "é&x=1 ".repeat(20)})).not.toContain("&x=1")
  })
})

describe("invitations", () => {
  it("aller-retour et validation stricte", () => {
    const text = encodeInvite(room, "c".repeat(64))

    expect(parseInvite(text, now)?.room).toBe(room.room)
    expect(inspectInvite(text, now)).toMatchObject({
      expired: false,
      invite: {password: room.password},
    })
  })

  it("refuse tout ce qui n'est pas une invitation conforme", () => {
    const base = JSON.parse(encodeInvite(room))
    const bad = (patch: object) => JSON.stringify({...base, ...patch})

    expect(parseInvite("bonjour", now)).toBeNull()
    expect(parseInvite("{pas du json", now)).toBeNull()
    expect(parseInvite(bad({base: "http://evil.example"}), now)).toBeNull()
    expect(parseInvite(bad({base: "https://evil.example/chemin"}), now)).toBeNull()
    expect(parseInvite(bad({room: "../x"}), now)).toBeNull()
    expect(parseInvite(bad({pw: "court"}), now)).toBeNull()
    expect(parseInvite(bad({t: "autre"}), now)).toBeNull()
    expect(parseInvite(bad({exp: "demain"}), now)).toBeNull()
  })

  it("périmée : reconnue pour l'affichage « expirée », jamais ouvrable", () => {
    const old = encodeInvite({...room, expires_at: now - 5})

    expect(inspectInvite(old, now)?.expired).toBe(true)
    expect(parseInvite(old, now)).toBeNull()
  })

  it("échéance absurdement lointaine refusée", () => {
    expect(inspectInvite(encodeInvite({...room, expires_at: now + 10 * 86400}), now)?.expired).toBe(
      true,
    )
  })
})

describe("présence", () => {
  it("un battement vieux de plus de 6 minutes vaut hors ligne", () => {
    expect(presenceOf({status: "online", at: now - 60}, now)).toBe("online")
    expect(presenceOf({status: "visio", at: now - 400}, now)).toBe("offline")
    expect(presenceOf(undefined, now)).toBe("offline")
  })
})
