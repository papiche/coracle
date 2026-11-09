import {beforeEach, describe, expect, it, vi} from "vitest"
import {
  _resetAstroportdCache,
  followsLegacyApiConvention,
  basicHeader,
  fromUnlockAndKeys,
  isAstroportdState,
  keysBody,
  mapUnlockError,
  unlockBody,
  uploadAuthHeaders,
  feedbackBody,
  feedbackErrorKey,
  zenFromCents,
  stationChatUrl,
  knownAstroportd,
  probeAstroportd,
  sameHostApiUrl,
} from "src/util/astroportd"

const reply = (body: any, ok = true) =>
  vi.fn(async () => ({ok, json: async () => body})) as unknown as typeof fetch

describe("sameHostApiUrl", () => {
  it("maps ws(s) to http(s) on the same host and port", () => {
    expect(sameHostApiUrl("wss://station.example.org")).toBe("https://station.example.org")
    expect(sameHostApiUrl("ws://192.168.1.5:8080")).toBe("http://192.168.1.5:8080")
    expect(sameHostApiUrl("https://x.org")).toBeNull()
    expect(sameHostApiUrl("nope")).toBeNull()
  })
})

describe("followsLegacyApiConvention", () => {
  it("recognises u.<domain> and :54321 only", () => {
    expect(followsLegacyApiConvention("https://u.example.org")).toBe(true)
    expect(followsLegacyApiConvention("http://10.0.0.2:54321")).toBe(true)
    expect(followsLegacyApiConvention("https://station.example.org")).toBe(false)
  })
})

describe("probeAstroportd", () => {
  beforeEach(() => _resetAstroportdCache())

  it("accepts _source astroportd and caches", async () => {
    const f = reply({_source: "astroportd"})
    expect(await probeAstroportd("https://a.org/", f)).toBe(true)
    expect(await probeAstroportd("https://a.org", f)).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    expect((f as any).mock.calls[0][0]).toBe("https://a.org/12345")
    expect(knownAstroportd("https://a.org")).toBe(true)
  })

  it("rejects other payloads and caches the negative", async () => {
    expect(await probeAstroportd("https://b.org", reply({hostname: "x"}))).toBe(false)
    expect(knownAstroportd("https://b.org")).toBe(false)
    expect(isAstroportdState(null)).toBe(false)
  })

  it("does not cache network errors", async () => {
    const f = vi.fn(async () => {
      throw new Error("down")
    }) as unknown as typeof fetch
    expect(await probeAstroportd("https://c.org", f)).toBe(false)
    expect(knownAstroportd("https://c.org")).toBeUndefined()
  })
})

describe("unlock + keys", () => {
  it("builds the real bodies and Basic header", () => {
    expect(unlockBody(" a@b.c ", "123456")).toEqual({email: "a@b.c", pass: "123456"})
    expect(keysBody()).toEqual({confirm: true})
    expect(basicHeader("a@b.c", "tok")).toBe("Basic " + btoa("a@b.c:tok"))
  })

  it("maps errors from the stable server codes, never the message text", () => {
    expect(mapUnlockError({error: "x", code: "pass_denied"})).toMatchObject({
      code: "INVALID_PASS",
      locked: false,
    })
    expect(mapUnlockError({error: "peu importe", code: "pass_locked"})).toMatchObject({
      code: "INVALID_PASS",
      locked: true,
    })
    expect(mapUnlockError({error: "compte verrouillé", code: "rate_limited"})).toMatchObject({
      code: "UNKNOWN",
      message: "compte verrouillé",
    })
    expect(mapUnlockError({error: "code PASS : 4 à 6 chiffres"}).code).toBe("UNKNOWN")
    expect(mapUnlockError(null).code).toBe("UNKNOWN")
  })

  it("produces nsec and pass without inventing fields", () => {
    const r = fromUnlockAndKeys({email: "a@b.c", hex: "ab", token: "t"}, {nsec: "nsec1x", npub: "npub1x"}, "1234")
    expect(r).toMatchObject({nsec: "nsec1x", pass: "1234", hex: "ab"})
    expect(r.g1pub).toBeUndefined()
    expect(r).not.toHaveProperty("token")
    expect(fromUnlockAndKeys({hex: "ab"}, {}, "1234")).toBeNull()
  })
})

describe("uploadAuthHeaders", () => {
  const url = "https://s.org/api/upload/image"

  it("signs POST on the full upload URL for astroportd", async () => {
    const sign = vi.fn(async () => "Nostr abc")
    expect(await uploadAuthHeaders({uploadUrl: url, astroportd: true}, sign)).toEqual({
      Authorization: "Nostr abc",
    })
    expect(sign).toHaveBeenCalledWith(url, "POST")
  })

  it("adds nothing on legacy stations and never signs", async () => {
    const sign = vi.fn(async () => "Nostr abc")
    expect(await uploadAuthHeaders({uploadUrl: url}, sign)).toEqual({})
    expect(sign).not.toHaveBeenCalled()
  })
})

describe("zenFromCents", () => {
  it("uses integers and rejects bad values", () => {
    expect(zenFromCents(12340)).toBe(123)
    expect(zenFromCents(99)).toBe(0)
    expect(zenFromCents(undefined)).toBeNull()
    expect(zenFromCents("123")).toBeNull()
    expect(zenFromCents(1.5)).toBeNull()
  })
})

describe("feedback", () => {
  it("never shares identity unless asked", () => {
    const f = {title: "t", description: "d", shareIdentity: false}
    expect(feedbackBody(f)).toMatchObject({source: "coracle", share_identity: false})
    expect(feedbackBody({...f, shareIdentity: true}).share_identity).toBe(true)
    expect(feedbackBody({...f, appVersion: "abc"}).app_version).toBe("abc")
    expect(feedbackBody(f)).not.toHaveProperty("pubkey")
  })

  it("maps 401 and rate_limited", () => {
    expect(feedbackErrorKey(401, null)).toBe("feedbackCreate.authRequired")
    expect(feedbackErrorKey(429, {code: "rate_limited"})).toBe("feedbackCreate.rateLimited")
    expect(feedbackErrorKey(500, {})).toBeNull()
  })
})

describe("stationChatUrl", () => {
  it("deep-links the station chat for a valid peer only", () => {
    const hex = "ab".repeat(32)
    expect(stationChatUrl("https://s.org/", hex)).toBe(`https://s.org/#/chat?peer=${hex}`)
    expect(stationChatUrl("https://s.org", "zz")).toBeNull()
  })
})
