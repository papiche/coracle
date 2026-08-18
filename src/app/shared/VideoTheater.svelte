<script lang="ts">
  import {_} from "svelte-i18n"
  import type {TrustedEvent} from "@welshman/util"
  import {getReplyFilters, NOTE, COMMENT, REACTION, ZAP_RESPONSE} from "@welshman/util"
  import type {Thunk} from "@welshman/app"
  import {Router, addMaximalFallbacks} from "@welshman/router"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEvents} from "@welshman/store"
  import NoteHeader from "src/app/shared/NoteHeader.svelte"
  import NoteActions from "src/app/shared/NoteActions.svelte"
  import NoteReply from "src/app/shared/NoteReply.svelte"
  import {extractVideoInfo, cleanVideoTitle} from "src/util/video"
  import {getSetting, env, myLoad} from "src/engine"
  import {router} from "src/app/util"

  // Route path param, unused — events/index (via cx) carry the actual state.
  export const id = ""
  export let events: TrustedEvent[] = []
  export let index = 0

  let currentIndex = index
  let replyIsOpen = false

  $: event = events[currentIndex]
  $: info = event ? extractVideoInfo(event) : null
  $: title = info ? cleanVideoTitle(info) : ""
  $: hasPrev = currentIndex > 0
  $: hasNext = currentIndex < events.length - 1

  // Deletion is only safe while nothing else references this event: kind
  // 21/22 are non-addressable, so "deleting" means publish a kind-5 request
  // and hope every client honors it — any reply/reaction/zap already grafted
  // on by someone else would be left pointing at a hidden/gone parent.
  $: engagement = event
    ? deriveEvents({
        repository,
        filters: getReplyFilters([event], {kinds: [NOTE, COMMENT, REACTION, ZAP_RESPONSE]}),
      })
    : null
  $: hasExternalEngagement = Boolean(
    event && engagement && $engagement.some(e => e.pubkey !== event.pubkey),
  )

  const onClose = () => router.pop()

  const goPrev = () => {
    if (hasPrev) {
      currentIndex -= 1
      replyIsOpen = false
    }
  }

  const goNext = () => {
    if (hasNext) {
      currentIndex += 1
      replyIsOpen = false
    }
  }

  const onReplyStart = () => {
    replyIsOpen = true
  }

  const onReplyCancel = () => {
    replyIsOpen = false
  }

  const onReplyPublish = (thunk: Thunk) => {
    replyIsOpen = false
  }

  // Same confirmation flow as Message.svelte's delete button (NoteDelete.svelte)
  const removeVideo = () => {
    router.at("notes").of(event.id).at("delete").qp({kind: event.kind}).open()
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
    else if (e.key === "ArrowLeft") goPrev()
    else if (e.key === "ArrowRight") goNext()
  }

  // Load replies/reactions/zaps for the currently displayed video, same as Note.svelte
  const loadReplies = (e: TrustedEvent) => {
    const actions = getSetting("note_actions")
    const kinds = []

    if (actions.includes("replies")) {
      kinds.push(NOTE)
      kinds.push(COMMENT)
    }

    if (actions.includes("reactions")) {
      kinds.push(REACTION)
    }

    if (env.ENABLE_ZAPS && actions.includes("zaps")) {
      kinds.push(ZAP_RESPONSE)
    }

    myLoad({
      relays: Router.get().Replies(e).policy(addMaximalFallbacks).getUrls(),
      filters: getReplyFilters([e], {kinds}),
    })
  }

  $: if (event) loadReplies(event)
</script>

<svelte:window on:keydown={onKeydown} />

<div class="z-50 fixed inset-0 flex flex-col bg-black">
  <div class="flex items-center justify-between p-3">
    {#if events.length > 1}
      <span class="text-sm text-neutral-400">{currentIndex + 1} / {events.length}</span>
    {:else}
      <span />
    {/if}
    <div class="flex items-center gap-4">
      {#if event && event.pubkey === $pubkey}
        <button
          class="text-xl text-white"
          class:opacity-40={hasExternalEngagement}
          disabled={hasExternalEngagement}
          title={hasExternalEngagement ? $_("video.deleteBlockedByEngagement") : ""}
          on:click={removeVideo}>
          <i class="fa fa-trash" />
        </button>
      {/if}
      <button class="text-2xl text-white" on:click={onClose}>
        <i class="fa fa-times" />
      </button>
    </div>
  </div>

  {#if event && info}
    <div class="relative flex flex-1 items-center justify-center overflow-hidden px-2">
      {#if hasPrev}
        <button
          class="z-10 absolute left-2 flex h-10 w-10 items-center justify-center rounded-full bg-black bg-opacity-50 text-xl text-white transition-colors hover:bg-opacity-80"
          on:click={goPrev}>
          <i class="fa fa-chevron-left" />
        </button>
      {/if}
      {#key event.id}
        <!-- svelte-ignore a11y-media-has-caption -->
        <video
          controls
          autoplay
          playsinline
          src={info.videoUrl}
          class="max-h-full max-w-full rounded" />
      {/key}
      {#if hasNext}
        <button
          class="z-10 absolute right-2 flex h-10 w-10 items-center justify-center rounded-full bg-black bg-opacity-50 text-xl text-white transition-colors hover:bg-opacity-80"
          on:click={goNext}>
          <i class="fa fa-chevron-right" />
        </button>
      {/if}
    </div>

    <div class="max-h-[40vh] overflow-y-auto bg-neutral-900 p-4">
      <NoteHeader {event} showParent={false} />
      {#if info.seriesName}
        <div
          class="text-purple-400 mt-2 flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <i class="fa fa-tv shrink-0" />
          <span class="min-w-0 truncate">{info.seriesName}</span>
          {#if info.seasonNumber !== null && info.episodeNumber !== null}
            <span class="shrink-0 text-neutral-500"
              >S{info.seasonNumber} · E{info.episodeNumber}</span>
          {/if}
        </div>
      {/if}
      {#if title}
        <h3 class="mt-1 min-w-0 break-words text-lg font-bold text-white">{title}</h3>
      {/if}
      {#if event.content}
        <p class="mt-1 break-words text-sm text-neutral-300">{event.content}</p>
      {/if}
      <div class="mt-3">
        <NoteActions {event} {onReplyStart} />
      </div>
      <NoteReply parent={event} {replyIsOpen} {onReplyCancel} {onReplyPublish} />
    </div>
  {/if}
</div>
