import type {OwnedEvent, HashedEvent} from "@welshman/util"
import {makeEvent, getTag, own, getPubkey, makeSecret} from "@welshman/util"
import {synced, localStorageProvider, withGetter} from "@welshman/store"
import PowWorker from "src/workers/pow?worker"
import {isMobile} from "src/util/html"

export const benchmark = withGetter(
  synced({
    key: "benchmark",
    defaultValue: 0,
    storage: localStorageProvider,
  }),
)

export const benchmarkDifficulty = isMobile ? 14 : 16

export const estimateWork = (difficulty: number) =>
  Math.ceil(benchmark.get() * Math.pow(2, difficulty - benchmarkDifficulty))

export type ProofOfWork = {
  /** Cancel the PoW computation and reject the result promise immediately */
  cancel: () => void
  result: Promise<HashedEvent>
}

export const makePow = (event: OwnedEvent, difficulty: number): ProofOfWork => {
  const worker = new PowWorker()

  // Capture reject so cancel() can terminate the promise cleanly
  let _reject: (reason: Error) => void

  const result = new Promise<HashedEvent>((resolve, reject) => {
    _reject = reject

    worker.onmessage = (e: MessageEvent<HashedEvent>) => {
      resolve(e.data)
      worker.terminate()
    }

    worker.onerror = e => {
      reject(e)
      worker.terminate()
    }

    // Serialize only the canonical NIP-01 fields to avoid transferring
    // unexpected properties and to ensure key order is always correct.
    worker.postMessage({
      difficulty,
      event: {
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
      },
    })
  })

  const cancel = () => {
    worker.terminate()
    _reject(new Error("PoW cancelled"))
  }

  return {cancel, result}
}

export const getPow = (event: HashedEvent): number => {
  const difficulty = parseInt(getTag("nonce", event.tags)?.[2])

  if (isNaN(difficulty)) return 0

  let count = 0

  // Convert hex string to array of bytes
  for (let i = 0; i < event.id.length; i += 2) {
    const byte = parseInt(event.id.slice(i, i + 2), 16)
    if (byte === 0) {
      count += 8
    } else {
      count += Math.clz32(byte) - 24
      break
    }
  }

  return count >= difficulty ? difficulty : 0
}

// Generate a simple pow to estimate the device capacities
if (benchmark.get() === 0) {
  const secret = makeSecret()
  const pubkey = getPubkey(secret)
  const event = own(makeEvent(1, {}), pubkey)
  const pow = makePow(event, benchmarkDifficulty)
  const start = Date.now()

  pow.result.then(() => {
    benchmark.set(Date.now() - start)
  })
}
