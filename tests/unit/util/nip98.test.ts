import {describe, expect, it, vi} from "vitest"

// Signature factice : l'« id » dépend du contenu complet (created_at, tags, content), comme un vrai id.
vi.mock("src/engine/state", () => ({sign: async (e: any) => ({...e, id: JSON.stringify(e)})}))

import {nip98Header} from "src/util/nip98"

const decode = (h: string) => {
  const b64 = h.replace("Nostr ", "").replace(/-/g, "+").replace(/_/g, "/")

  return JSON.parse(decodeURIComponent(escape(atob(b64))))
}

describe("nip98Header", () => {
  it("gives two distinct events for two identical calls in the same second", async () => {
    const url = "https://s.example.org/api/upload/image"
    const [a, b] = (await Promise.all([nip98Header(url, "post"), nip98Header(url, "post")])).map(decode)

    expect(a.created_at).toBe(b.created_at)
    expect(a.id).not.toBe(b.id)
    expect(a.tags).toContainEqual(["u", url])
    expect(a.tags).toContainEqual(["method", "POST"])
  })
})
