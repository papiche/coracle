import type {Session} from "@welshman/app"
import type {TrustedEvent, Zapper as WelshmanZapper} from "@welshman/util"

export type Zapper = WelshmanZapper & {
  lnurl: string
  pubkey: string
}

export type Notification = {
  key: string
  type: string
  root: string
  timestamp: number
  interactions: TrustedEvent[]
}

export enum OnboardingTask {
  BackupKey = "backup_key",
  SetupWallet = "setup_wallet",
}
export type Topic = {
  name: string
  count?: number
  last_seen?: number
}

export type Channel = {
  id: string
  last_sent?: number
  last_received?: number
  last_checked?: number
  messages: TrustedEvent[]
}

export type SessionWithMeta = Session & {
  onboarding_tasks_completed?: string[]
}

/** Shape of kind:0 profile metadata with UPlanet/ZEN identity extensions */
export type NostrProfileMeta = {
  name?: string
  display_name?: string
  picture?: string
  banner?: string
  about?: string
  website?: string
  nip05?: string
  lud06?: string
  lud16?: string
  /** Ğ1 v1 public key — MULTIPASS usage token wallet */
  g1pub?: string
  /** Duniter v2s SS58 address — MULTIPASS v2 wallet */
  g1v2?: string
  /** ZEN Card (property token) Ğ1 v1 address */
  zencard?: string
  /** ZEN Card (property token) SS58 address */
  zencard_v2?: string
  /** IPNS key for the user's personal uDRIVE / geo-messages vault */
  ipns_vault?: string
  /** IPFS gateway base URL preferred by this user */
  ipfs_gw?: string
  /** TW Feed IPNS key (ThinkWise / educational content) */
  tw_feed?: string
}

export type AnonymousUserState = {
  follows: string[][]
  relays: string[][]
}
