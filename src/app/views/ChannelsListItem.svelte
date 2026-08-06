<script lang="ts">
  import cx from "classnames"
  import {derived} from "svelte/store"
  import {pubkey, profiles, displayProfileByPubkey} from "@welshman/app"
  import {without, displayList, sortBy, formatTimestampRelative} from "@welshman/lib"
  import PersonCircle from "src/app/shared/PersonCircle.svelte"
  import PersonCircles from "src/app/shared/PersonCircles.svelte"
  import Card from "src/partials/Card.svelte"
  import {router} from "src/app/util/router"
  import {channelHasNewMessages, channelUnreadCount, getMessageView} from "src/engine"
  import type {Channel} from "src/engine"

  export let channel: Channel

  const pubkeys = channel.id.split(",")
  const members = pubkeys.length === 1 ? pubkeys : without([$pubkey], pubkeys)
  const membersDisplay = derived(profiles, () => members.map(displayProfileByPubkey))
  const [lastMessage] = sortBy(m => -m.created_at, channel.messages)

  const enter = () => router.at("channels").of(pubkeys).push()

  $: unread = channelUnreadCount(channel)
  $: showAlert = channelHasNewMessages(channel)
</script>

<Card interactive on:click={enter} class="flex items-center gap-3">
  {#if members.length === 1}
    <PersonCircle pubkey={members[0]} class="h-12 w-12 shrink-0" />
  {:else}
    <PersonCircles pubkeys={members} class="h-12 w-12 shrink-0" />
  {/if}
  <div class="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
    <div class="flex items-center justify-between gap-2">
      <h2 class="truncate font-bold">{displayList($membersDisplay)}</h2>
      <span class="shrink-0 text-xs text-neutral-400">
        {formatTimestampRelative(lastMessage.created_at)}
      </span>
    </div>
    <div class="flex items-center justify-between gap-2">
      {#await getMessageView(lastMessage)}
        <p class="truncate text-sm text-neutral-400">...</p>
      {:then view}
        <p class={cx("truncate text-sm", showAlert ? "text-neutral-100" : "text-neutral-400")}>
          {#if lastMessage.pubkey === $pubkey}<span class="text-neutral-500">You: </span>{/if}
          {#if view.channelLabel}<span class="font-bold text-accent"
              >{view.channelLabel} ·
            </span>{/if}
          {view.text}
        </p>
      {:catch}
        <p class="truncate text-sm text-neutral-400">🔒 Encrypted message</p>
      {/await}
      {#if unread > 0}
        <span class="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">
          {unread}
        </span>
      {/if}
    </div>
  </div>
</Card>
