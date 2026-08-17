<script lang="ts">
  import {onMount} from "svelte"
  import {_} from "svelte-i18n"
  import {uniqBy} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {makeFeedController} from "@welshman/app"
  import {pubkey, signer} from "@welshman/app"
  import {makeIntersectionFeed, makeKindFeed} from "@welshman/feeds"
  import {createScroller} from "src/util/misc"
  import {fly} from "src/util/transition"
  import Button from "src/partials/Button.svelte"
  import Spinner from "src/partials/Spinner.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import VocalCard from "src/app/shared/VocalCard.svelte"
  import VocalRecorder from "src/app/shared/VocalRecorder.svelte"
  import {sortEventsDesc} from "src/engine"
  import {VOCAL_ROOT, VOCAL_REPLY} from "src/util/vocals"

  let element: HTMLElement
  let events: TrustedEvent[] = []
  let buffer: TrustedEvent[] = []
  let exhausted = false
  let abort = new AbortController()
  let ctrl: ReturnType<typeof makeFeedController> | null = null
  let loading = false

  let showRecorder = false
  let replyTo: {id: string; pubkey: string; relay?: string} | undefined = undefined

  const feed = {
    title: "Vocaux",
    identifier: "vocaux",
    description: "Voice messages",
    definition: makeIntersectionFeed(makeKindFeed(VOCAL_ROOT, VOCAL_REPLY)),
  }

  const loadEvents = () => {
    abort.abort()
    abort = new AbortController()
    events = []
    buffer = []
    exhausted = false
    loading = false

    ctrl = makeFeedController({
      feed: feed.definition,
      useWindowing: true,
      signal: abort.signal,
      onEvent: e => {
        buffer.push(e)
      },
      onExhausted: () => {
        exhausted = true
        loading = false
      },
    })

    loadMore()
  }

  const loadMore = async () => {
    if (!ctrl || loading) return
    loading = true
    const current = ctrl

    await current.load(20)

    if (current !== ctrl) {
      loading = false
      return
    }

    buffer = uniqBy(e => e.id, sortEventsDesc(buffer))
    events = [...events, ...buffer.splice(0, 20)]
    loading = false
  }

  const openNewMessage = () => {
    replyTo = undefined
    showRecorder = true
  }

  const openReply = (parent: TrustedEvent) => {
    replyTo = {id: parent.id, pubkey: parent.pubkey}
    showRecorder = true
  }

  const closeRecorder = () => {
    showRecorder = false
  }

  const onPublished = () => {
    loadEvents()
  }

  onMount(() => {
    loadEvents()
    const scroller = createScroller(loadMore, {element, delay: 300, threshold: 3000})
    return () => {
      scroller.stop()
      abort.abort()
    }
  })

  document.title = $_("menu.vocaux")
</script>

<FlexColumn bind:element>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <i class="fa fa-microphone fa-lg" />
      <h2 class="staatliches text-2xl">{$_("menu.vocaux")}</h2>
    </div>
    {#if $signer}
      <Button class="btn btn-accent" on:click={openNewMessage}>
        <i class="fa fa-microphone" />
        {$_("vocaux.newMessage") || "Nouveau message vocal"}
      </Button>
    {/if}
  </div>

  {#if !$pubkey}
    <div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <i class="fa fa-microphone-slash fa-3x text-tinted-500" />
      <p class="text-lg text-tinted-400">
        {$_("vocaux.loginRequired") ||
          "Connectez-vous pour écouter et enregistrer des messages vocaux."}
      </p>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each events as event (event.id)}
        <div in:fly={{y: 20}}>
          <VocalCard {event} onReply={openReply} />
        </div>
      {/each}
    </div>

    {#if loading && events.length === 0}
      <Spinner />
    {:else if !exhausted && events.length > 0}
      <Spinner />
    {:else if exhausted && events.length === 0}
      <div class="py-16 text-center">
        <i class="fa fa-microphone-slash mb-3 text-5xl text-neutral-700" />
        <p class="text-neutral-400">
          {$_("vocaux.empty") || "Aucun message vocal pour l'instant."}
        </p>
      </div>
    {/if}
  {/if}
</FlexColumn>

{#if showRecorder}
  <VocalRecorder {replyTo} onClose={closeRecorder} {onPublished} />
{/if}
