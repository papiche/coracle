<script lang="ts">
  import cx from "classnames"
  import {formatTimestamp} from "@welshman/lib"
  import {PublishStatus} from "@welshman/net"
  import {abortThunk, session, thunkHasStatus, thunks} from "@welshman/app"
  import {fly} from "svelte/transition"
  import {ticker} from "src/util/misc"
  import Modal from "src/partials/Modal.svelte"
  import Popover from "src/partials/Popover.svelte"
  import Link from "src/partials/Link.svelte"
  import {renderChatMarkdown} from "src/util/markdown"
  import PersonCircle from "src/app/shared/PersonCircle.svelte"
  import PersonName from "src/app/shared/PersonName.svelte"
  import NoteInfo from "src/app/shared/NoteInfo.svelte"
  import ExpirationBadge from "src/app/shared/ExpirationBadge.svelte"
  import {getMessageView, userSettings} from "src/engine"
  import {router} from "src/app/util/router"

  export let message

  const deleteMessage = () =>
    router.at("notes").of(message.id).at("delete").qp({kind: message.kind}).open()

  const elapsed = ticker()

  let showDetails = false

  $: thunk = $thunks.find(t => t.event.id === message.id)
  $: remaining = Math.ceil($userSettings.send_delay / 1000) - $elapsed
</script>

<div in:fly={{y: 20}} class="grid gap-2 py-1">
  <div
    class={cx("flex max-w-xl flex-col gap-2 rounded-2xl px-4 py-2", {
      "ml-12 justify-self-end rounded-br-none bg-neutral-100 text-neutral-800":
        message.pubkey === $session.pubkey,
      "mr-12 rounded-bl-none bg-tinted-800": message.pubkey !== $session.pubkey,
    })}>
    {#if message.showProfile && message.pubkey !== $session.pubkey}
      <Link
        modal
        href={router.at("people").of(message.pubkey).toString()}
        class="relative z-feature flex items-center gap-2">
        <PersonCircle pubkey={message.pubkey} class="h-8 w-8" />
        <PersonName pubkey={message.pubkey} />
      </Link>
    {/if}
    <div class="break-words">
      {#await getMessageView(message)}
        <!-- pass -->
      {:then view}
        {#if view.channelLabel}
          <div
            class="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-accent">
            <i class="fa {view.channelLabel === 'BRO' ? 'fa-robot' : 'fa-server'}" />
            {view.channelLabel}
            {#if view.channelName && view.channelName !== "bro_ia"}
              <span class="font-normal text-neutral-400">· {view.channelName}</span>
            {/if}
          </div>
        {/if}
        {#if view.imageUrl}
          <div class="flex items-center gap-1 text-xs text-neutral-400">
            <i class="fa fa-lock" />
            {view.text}
          </div>
          <img src={view.imageUrl} alt={view.text} class="max-w-full rounded" />
        {:else}
          <div class="long-form-content break-words">{@html renderChatMarkdown(view.text)}</div>
        {/if}
      {:catch}
        <p class="text-neutral-400">🔒 Unable to decrypt this message</p>
      {/await}
    </div>
    <small
      class="mt-1 flex items-center justify-between gap-2 text-xs"
      class:text-tinted-700={message.pubkey === $session.pubkey}
      class:text-neutral-100={message.pubkey !== $session.pubkey}>
      {#if thunk}
        {#if thunkHasStatus(PublishStatus.Pending, thunk)}
          <div class="flex items-center gap-1">
            <i class="fa fa-circle-notch fa-spin"></i>
            Sending...
            {#if remaining > 0}
              <button
                class="cursor-pointer py-1 text-tinted-700-d underline"
                on:click={() => abortThunk(thunk)}>Cancel</button>
            {/if}
          </div>
        {:else}
          {formatTimestamp(message.created_at)}
        {/if}
      {:else}
        {formatTimestamp(message.created_at)}
      {/if}
      <div class="flex items-center gap-3">
        <ExpirationBadge tags={message.tags} />
        {#if message.pubkey === $session.pubkey}
          <i class="fa fa-trash cursor-pointer text-neutral-400" on:click={deleteMessage} />
        {/if}
        <i
          class="fa fa-info-circle cursor-pointer text-neutral-400"
          on:click={() => (showDetails = true)} />
        {#if message.kind === 4}
          <Popover triggerType="mouseenter">
            <i slot="trigger" class="fa fa-unlock cursor-pointer text-neutral-400" />
            <p slot="tooltip">
              This message was sent using nostr's legacy DMs, which have a number of shortcomings.
              Read more <Link class="underline" modal href="/help/nip-17-dms">here</Link>.
            </p>
          </Popover>
        {:else}
          <Popover triggerType="mouseenter">
            <i slot="trigger" class="fa fa-lock cursor-pointer text-neutral-400" />
            <div slot="tooltip" class="flex flex-col gap-2">
              <p>
                This message was sent using nostr's new group chat specification, which solves
                several problems with legacy DMs. Read more <Link
                  class="underline"
                  modal
                  href="/help/nip-17-dms">here</Link
                >.
              </p>
              {#if message.pubkey === $session.pubkey}
                <p>
                  Note that these messages are not yet universally supported. Make sure the person
                  you're chatting with is using a compatible nostr client.
                </p>
              {/if}
            </div>
          </Popover>
        {/if}
      </div>
    </small>
  </div>
</div>

{#if showDetails}
  <Modal onEscape={() => (showDetails = false)}>
    <NoteInfo event={message} />
  </Modal>
{/if}
