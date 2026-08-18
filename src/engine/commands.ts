import {nwc} from "@getalby/sdk"
import {
  follow as baseFollow,
  unfollow as baseUnfollow,
  userMessagingRelayList,
  pubkey,
  repository,
  session,
  signer,
  tagPubkey,
  userRelayList,
  userBlossomServerList,
  publishThunk,
  sendWrapped,
} from "@welshman/app"
import {append, first, sha256, remove, nthNe, uniq} from "@welshman/lib"
import {Nip01Signer} from "@welshman/signer"
import type {TrustedEvent} from "@welshman/util"
import {Router, addMaximalFallbacks, addMinimalFallbacks} from "@welshman/router"
import {
  Address,
  DELETE,
  FEEDS,
  FOLLOWS,
  MESSAGING_RELAYS,
  PROFILE,
  RELAYS,
  DIRECT_MESSAGE,
  DEPRECATED_DIRECT_MESSAGE,
  addToListPublicly,
  makeEvent,
  getAddress,
  getTagValue,
  getListTags,
  isReplaceableKind,
  isSignedEvent,
  makeList,
  uploadBlob,
  makeBlossomAuthEvent,
  normalizeRelayUrl,
  removeFromList,
  getRelaysFromList,
} from "@welshman/util"
import {npubEncode} from "nostr-tools/nip19"
import {
  anonymous,
  env,
  getClientTags,
  sign,
  userFeedFavorites,
  withIndexers,
} from "src/engine/state"
import {stripExifData} from "src/util/html"
import {appDataKeys} from "src/util/nostr"
import {ensureProto} from "src/util/misc"
import {getVerifiedUPlanet} from "src/util/uplanet-detect"
import {get} from "svelte/store"

// Helpers

export const updateRecord = (record, timestamp, updates) => {
  for (const [field, value] of Object.entries(updates)) {
    const tsField = `${field}_updated_at`
    const lastUpdated = record?.[tsField] || -1

    if (timestamp > lastUpdated) {
      record = {
        ...record,
        [field]: value,
        [tsField]: timestamp,
        updated_at: Math.max(timestamp, record?.updated_at || 0),
      }
    }
  }

  return record
}

export const updateStore = (store, timestamp, updates) =>
  store.set(updateRecord(store.get(), timestamp, updates))

export const nip44EncryptToSelf = (payload: string) =>
  signer.get().nip44.encrypt(pubkey.get(), payload)

// Files

export const uploadFile = async (server: string, file: File, compressorOpts = {}) => {
  if (!file.type.match("image/(webp|gif)")) {
    file = await stripExifData(file, compressorOpts)
  }

  const hashes = [await sha256(await file.arrayBuffer())]
  const $signer = signer.get() || Nip01Signer.ephemeral()
  const authEvent = await $signer.sign(makeBlossomAuthEvent({action: "upload", server, hashes}))
  const res = await uploadBlob(server, file, {authEvent})

  return res.json()
}

/**
 * Upload a single image and return its URL — same resolution order as the
 * note editor's image drop/paste handler (src/app/editor/index.ts): the
 * user's own UPlanet station first (if verified and no Blossom server is
 * configured), falling back to the configured/default Blossom server.
 */
export const uploadImage = async (file: File): Promise<string> => {
  const userServer = getTagValue("server", getListTags(get(userBlossomServerList)))

  const up = !userServer && getVerifiedUPlanet()
  if (up) {
    const formData = new FormData()
    formData.append("file", file)
    const currentPubkey = get(pubkey)
    if (currentPubkey) {
      try {
        formData.append("npub", npubEncode(currentPubkey))
      } catch {
        // invalid pubkey — continue without npub
      }
    }
    formData.append("type", "media")
    try {
      const res = await fetch(up.uploadUrl, {method: "POST", body: formData})
      if (res.ok) {
        const data = await res.json()
        if (data.url) return data.url
      }
    } catch {
      // fall through to Blossom
    }
  }

  const server = ensureProto(userServer || first(env.BLOSSOM_URLS))
  const {uploaded, url} = await uploadFile(server, file)

  if (!uploaded) {
    throw new Error("Server refused to process the file")
  }

  return new URL(url).pathname.split(".").length === 1 ? `${url}.${file.type.split("/")[1]}` : url
}

// Key state management

export const signAndPublish = async (template, {anonymous = false} = {}) => {
  const event = await sign(template, {anonymous})
  const relays = Router.get().PublishEvent(event).policy(addMinimalFallbacks).getUrls()

  return await publishThunk({event, relays})
}

// Deletes

export const publishDeletion = ({kind, address = null, id = null}) => {
  const tags = [["k", String(kind)]]

  if (address) {
    tags.push(["a", address])
  }

  if (id) {
    tags.push(["e", id])
  }

  return publishThunk({
    event: makeEvent(DELETE, {tags}),
    relays: Router.get().FromUser().policy(addMaximalFallbacks).getUrls(),
  })
}

// getAddress() returns a kind:pubkey:d address even for non-addressable kinds
// (using "" for the missing "d" tag) — every regular-kind event (1, 21, 22...)
// from the same author then shares that exact address. The repository tracks
// deletes by address and hides any event older than the delete's created_at,
// so including that tag here would locally hide every past note of that kind
// from this author, not just the one being deleted (see isReplaceableKind).
export const deleteEvent = (event: TrustedEvent) =>
  publishDeletion({
    id: event.id,
    address: isReplaceableKind(event.kind) ? getAddress(event) : null,
    kind: event.kind,
  })

export const deleteEventByAddress = (address: string) =>
  publishDeletion({address, kind: Address.from(address).kind})

// Follows

export const unfollow = async (value: string) =>
  signer.get()
    ? baseUnfollow(value)
    : anonymous.update($a => ({...$a, follows: $a.follows.filter(nthNe(1, value))}))

export const follow = async (tag: string[]) =>
  signer.get()
    ? baseFollow(tag)
    : anonymous.update($a => ({...$a, follows: append(tag, $a.follows)}))

// Feed favorites

export const removeFeedFavorite = async (address: string) => {
  const list = get(userFeedFavorites) || makeList({kind: FEEDS})

  return publishThunk({
    event: await removeFromList(list, address).reconcile(nip44EncryptToSelf),
    relays: Router.get().FromUser().policy(addMaximalFallbacks).getUrls(),
  })
}

export const addFeedFavorite = async (address: string) => {
  const list = get(userFeedFavorites) || makeList({kind: FEEDS})

  return publishThunk({
    event: await addToListPublicly(list, ["a", address]).reconcile(nip44EncryptToSelf),
    relays: Router.get().FromUser().policy(addMaximalFallbacks).getUrls(),
  })
}

// Relays

export const requestRelayAccess = async (url: string, claim: string) =>
  publishThunk({event: makeEvent(28934, {tags: [["claim", claim]]}), relays: [url]})

export const setOutboxPolicies = async (modifyTags: (tags: string[][]) => string[][]) => {
  if (signer.get()) {
    const list = get(userRelayList) || makeList({kind: RELAYS})

    publishThunk({
      event: makeEvent(list.kind, {
        content: list.event?.content || "",
        tags: modifyTags(list.publicTags),
      }),
      relays: withIndexers(Router.get().FromUser().policy(addMaximalFallbacks).getUrls()),
    })
  } else {
    anonymous.update($a => ({...$a, relays: modifyTags($a.relays)}))
  }
}

export const setMessagingPolicies = async (modifyTags: (tags: string[][]) => string[][]) => {
  const list = get(userMessagingRelayList) || makeList({kind: MESSAGING_RELAYS})

  publishThunk({
    event: makeEvent(list.kind, {
      content: list.event?.content || "",
      tags: modifyTags(list.publicTags),
    }),
    relays: withIndexers(Router.get().FromUser().policy(addMaximalFallbacks).getUrls()),
  })
}

export const setMessagingPolicy = (url: string, enabled: boolean) => {
  const urls = getRelaysFromList(get(userMessagingRelayList))

  // Only update messaging policies if they already exist or we're adding them
  if (enabled || urls.includes(url)) {
    setMessagingPolicies($tags => {
      $tags = $tags.filter(t => normalizeRelayUrl(t[1]) !== url)

      if (enabled) {
        $tags.push(["relay", url])
      }

      return $tags
    })
  }
}

export const setOutboxPolicy = (url: string, read: boolean, write: boolean) =>
  setOutboxPolicies($tags => {
    $tags = $tags.filter(t => normalizeRelayUrl(t[1]) !== url)

    if (read && write) {
      $tags.push(["r", url])
    } else if (read) {
      $tags.push(["r", url, "read"])
    } else if (write) {
      $tags.push(["r", url, "write"])
    }

    return $tags
  })

export const leaveRelay = async (url: string) => {
  await Promise.all([setMessagingPolicy(url, false), setOutboxPolicy(url, false, false)])

  // Make sure the new relay selections get to the old relay
  if (pubkey.get()) {
    broadcastUserData([url])
  }
}

export const joinRelay = async (url: string, claim?: string) => {
  url = normalizeRelayUrl(url)

  if (claim && signer.get()) {
    await requestRelayAccess(url, claim)
  }

  await setOutboxPolicy(url, true, true)

  // Re-publish user meta to the new relay
  if (pubkey.get()) {
    broadcastUserData([url])
  }
}

// Messages

export const sendMessage = (channelId: string, content: string, delay: number) => {
  const recipients = uniq(channelId.split(",").concat(pubkey.get()))

  return sendWrapped({
    delay,
    recipients,
    event: makeEvent(DIRECT_MESSAGE, {
      content,
      tags: [...remove(pubkey.get(), recipients).map(tagPubkey), ...getClientTags()],
    }),
  })
}

// UPlanet's bro_dm_daemon.sh only ever listens for legacy kind-4 DMs (never the
// NIP-59 gift-wrapped kind-1059 that sendMessage/sendWrapped produces), so an
// encrypted image bound for BRO/NODE must be sent as a raw kind-4 event —
// NIP-44 encrypted directly, matching Astroport.ONE/tools/nostr_node_intercom.py.
export const sendEncryptedImageDM = async (
  recipient: string,
  envelope: {cid: string; encKey: string; iv: string; filename: string; hint?: string},
) => {
  const content = JSON.stringify({
    _uenc_img: {
      cid: envelope.cid,
      enc_key: envelope.encKey,
      iv: envelope.iv,
      filename: envelope.filename,
      hint: envelope.hint || "",
    },
  })

  const encrypted = await signer.get().nip44.encrypt(recipient, content)

  return signAndPublish(
    makeEvent(DEPRECATED_DIRECT_MESSAGE, {
      content: encrypted,
      tags: [tagPubkey(recipient), ...getClientTags()],
    }),
  )
}

// Settings

export const setAppData = async (d: string, data: any) => {
  if (signer.get()) {
    const {pubkey} = session.get()
    const content = await signer.get().nip04.encrypt(pubkey, JSON.stringify(data))

    return publishThunk({
      event: makeEvent(30078, {tags: [["d", d]], content}),
      relays: Router.get().FromUser().policy(addMaximalFallbacks).getUrls(),
    })
  }
}

export const publishSettings = ($settings: Record<string, any>) =>
  setAppData(appDataKeys.USER_SETTINGS, $settings)

export const broadcastUserRelays = async (relays: string[]) => {
  const authors = [pubkey.get()]
  const kinds = [RELAYS]
  const events = repository.query([{kinds, authors}])

  for (const event of events) {
    if (isSignedEvent(event)) {
      await publishThunk({event, relays})
    }
  }
}

export const broadcastUserData = async (relays: string[]) => {
  const authors = [pubkey.get()]
  const kinds = [RELAYS, MESSAGING_RELAYS, FOLLOWS, PROFILE]
  const events = repository.query([{kinds, authors}])

  for (const event of events) {
    if (isSignedEvent(event)) {
      await publishThunk({event, relays})
    }
  }
}

// Lightning

export const getWebLn = () => (window as any).webln

export const payInvoice = async (invoice: string) => {
  const {wallet} = session.get()

  if (!wallet) {
    return alert(invoice)
  }

  if (wallet.type === "nwc") {
    return new nwc.NWCClient(wallet.info).payInvoice({invoice})
  } else if (wallet.type === "webln") {
    return getWebLn()
      .enable()
      .then(() => getWebLn().sendPayment(invoice))
  }
}
