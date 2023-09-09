import {Fetch} from "hurdak"
import {tryJson} from "src/util/misc"
import {invoiceAmount} from "src/util/lightning"
import {warn} from "src/util/logger"
import {Tags} from "src/util/nostr"
import type {Event, ZapEvent} from "src/engine2/model"
import {people} from "src/engine2/state"

export function processZaps(zaps: Event[], pubkey: string) {
  const {zapper} = people.key(pubkey).get() || {}

  if (!zapper) {
    return []
  }

  return zaps
    .map((zap: Event) => {
      const zapMeta = Tags.from(zap).asMeta() as {
        bolt11: string
        description: string
      }

      return tryJson(() => ({
        ...zap,
        invoiceAmount: invoiceAmount(zapMeta.bolt11),
        request: JSON.parse(zapMeta.description),
      })) as ZapEvent
    })
    .filter((zap: ZapEvent) => {
      if (!zap) {
        return false
      }

      // Don't count zaps that the user sent himself
      if (zap.request.pubkey === pubkey) {
        return false
      }

      const {invoiceAmount, request} = zap
      const reqMeta = Tags.from(request).asMeta() as {
        amount?: string
        lnurl?: string
      }

      // Verify that the zapper actually sent the requested amount (if it was supplied)
      if (reqMeta.amount && parseInt(reqMeta.amount) !== invoiceAmount) {
        return false
      }

      // If the sending client provided an lnurl tag, verify that too
      if (reqMeta.lnurl && reqMeta.lnurl !== zapper.lnurl) {
        return false
      }

      // Verify that the zap note actually came from the recipient's zapper
      if (zapper.nostrPubkey !== zap.pubkey) {
        return false
      }

      return true
    })
}

export async function fetchInvoice(zapper, event, amount) {
  const {callback, lnurl} = zapper
  const s = encodeURI(JSON.stringify(event))
  const res = await Fetch.fetchJson(`${callback}?amount=${amount}&nostr=${s}&lnurl=${lnurl}`)

  if (!res.pr) {
    warn(JSON.stringify(res))
  }

  return res?.pr
}

export async function collectInvoice(invoice) {
  const {webln} = window as {webln?: any}

  if (webln) {
    await webln.enable()

    try {
      webln.sendPayment(invoice)
    } catch (e) {
      warn(e)
    }
  }
}
