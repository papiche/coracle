<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {getReplyFilters, NOTE, COMMENT, REACTION, ZAP_RESPONSE} from "@welshman/util"
  import type {Thunk} from "@welshman/app"
  import {Router, addMaximalFallbacks} from "@welshman/router"
  import NoteHeader from "src/app/shared/NoteHeader.svelte"
  import NoteActions from "src/app/shared/NoteActions.svelte"
  import NoteReply from "src/app/shared/NoteReply.svelte"
  import {extractVideoInfo} from "src/util/video"
  import {getSetting, env, myLoad} from "src/engine"
  import {router} from "src/app/util"

  export let id = ""
  export let events: TrustedEvent[] = []
  export let index = 0

  let currentIndex = index
  let replyIsOpen = false

  $: event = events[currentIndex]
  $: info = event ? extractVideoInfo(event) : null
  $: hasPrev = currentIndex > 0
  $: hasNext = currentIndex < events.length - 1

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
    <button class="text-2xl text-white" on:click={onClose}>
      <i class="fa fa-times" />
    </button>
    {#if events.length > 1}
      <span class="text-sm text-neutral-400">{currentIndex + 1} / {events.length}</span>
    {/if}
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
      {#if info.title}
        <h3 class="mt-2 break-words text-lg font-bold text-white">{info.title}</h3>
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
