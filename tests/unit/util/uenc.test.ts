import {describe, it, expect} from "vitest"
import {
  encryptUenc,
  decryptUenc,
  rawCidMatches,
  gatewayOrigin,
  gatewayCandidates,
} from "src/util/uenc"

const b32 = (bytes: Uint8Array) => {
  const A = "abcdefghijklmnopqrstuvwxyz234567"
  let bits = 0
  let acc = 0
  let out = ""

  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += A[(acc >> bits) & 31]
    }
  }

  if (bits > 0) out += A[(acc << (5 - bits)) & 31]

  return out
}

const cidOf = async (bytes: Uint8Array) =>
  "b" +
  b32(
    Uint8Array.from([
      0x01,
      0x55,
      0x12,
      0x20,
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]),
  )

describe("uenc", () => {
  it("chiffre au format UENC v1 et se déchiffre avec la clé seule", async () => {
    const data = new TextEncoder().encode("bonjour").buffer as ArrayBuffer
    const {payload, keyHex, ivHex} = await encryptUenc(data)

    expect(Array.from(payload.slice(0, 6))).toEqual([0x55, 0x45, 0x4e, 0x43, 1, 1])
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(ivHex).toBe(
      Array.from(payload.slice(6, 18), b => b.toString(16).padStart(2, "0")).join(""),
    )
    expect(new TextDecoder().decode(await decryptUenc(payload, keyHex))).toBe("bonjour")
    // jamais le clair dans les octets envoyés
    expect(new TextDecoder("latin1").decode(payload)).not.toContain("bonjour")
  })

  it("refuse une mauvaise clé, un en-tête faux et un message tronqué", async () => {
    const {payload, keyHex} = await encryptUenc(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer)
    const other = "00".repeat(32)

    await expect(decryptUenc(payload, other)).rejects.toThrow()
    await expect(decryptUenc(payload.slice(0, 20), keyHex)).rejects.toThrow("Invalid UENC")

    const bad = payload.slice()

    bad[0] = 0x58
    await expect(decryptUenc(bad, keyHex)).rejects.toThrow("Invalid UENC")
  })

  it("vérifie les octets d'une passerelle contre le CID raw sha2-256", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6])
    const cid = await cidOf(bytes)

    expect(cid.startsWith("bafkrei")).toBe(true)
    expect(await rawCidMatches(cid, bytes)).toBe(true)
    expect(await rawCidMatches(cid, new Uint8Array([9, 8, 7, 5]))).toBe(false)
    // formes non vérifiables d'un bloc : null, jamais « vrai » par défaut
    expect(await rawCidMatches("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", bytes)).toBeNull()
    expect(
      await rawCidMatches("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", bytes),
    ).toBeNull()
    expect(await rawCidMatches("b!!!", bytes)).toBeNull()
  })

  it("ne retient que des passerelles https (ou locales), sans identifiants, dédoublonnées", () => {
    expect(gatewayOrigin("https://station.test/ipfs/x?y#z")).toBe("https://station.test")
    expect(gatewayOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080")
    for (const bad of [
      "http://evil.test",
      "javascript:alert(1)",
      "https://u:p@a.test",
      "ftp://a.test",
      42,
      null,
      "x",
    ]) {
      expect(gatewayOrigin(bad)).toBeNull()
    }
    expect(
      gatewayCandidates(
        ["https://a.test", "http://evil.test", "https://a.test/", "https://b.test"],
        "https://b.test",
      ),
    ).toEqual(["https://a.test", "https://b.test"])
    expect(gatewayCandidates(undefined, "https://app.test")).toEqual(["https://app.test"])
  })
})
