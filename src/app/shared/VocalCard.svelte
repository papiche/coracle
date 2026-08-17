<script lang="ts">
  import {formatTimestamp} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import PersonCircle from "src/app/shared/PersonCircle.svelte"
  import PersonName from "src/app/shared/PersonName.svelte"
  import ExpirationBadge from "src/app/shared/ExpirationBadge.svelte"
  import NoteContentKind1222 from "src/app/shared/NoteContentKind1222.svelte"
  import {router} from "src/app/util/router"
  import {deleteEvent} from "src/engine"

  export let event: TrustedEvent
  export let onReply: (event: TrustedEvent) => void

  const openProfile = () => router.at("people").of(event.pubkey).open()
  const remove = () => deleteEvent(event)
</script>

<div class="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
  <div class="flex items-center gap-2">
    <button on:click={openProfile}>
      <PersonCircle pubkey={event.pubkey} class="h-8 w-8" />
    </button>
    <div class="flex min-w-0 flex-1 flex-col">
      <button class="min-w-0 text-left" on:click={openProfile}>
        <PersonName pubkey={event.pubkey} />
      </button>
      <span class="text-xs text-neutral-500">{formatTimestamp(event.created_at)}</span>
    </div>
    <ExpirationBadge tags={event.tags} />
  </div>

  <NoteContentKind1222 note={event} showEntire />

  <div class="flex items-center gap-3 pt-1 text-xs text-neutral-400">
    <button class="flex items-center gap-1 hover:text-accent" on:click={() => onReply(event)}>
      <i class="fa fa-microphone" />
      Répondre en vocal
    </button>
    {#if event.pubkey === $pubkey}
      <button class="hover:text-red-400 flex items-center gap-1" on:click={remove}>
        <i class="fa fa-trash" />
      </button>
    {/if}
  </div>
</div>
