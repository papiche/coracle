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
  import {VOCAL_ROOT, VOCAL_REPLY, extractVocalInfo} from "src/util/vocals"
  import {
    getCurrentUmap,
    toSector,
    toRegion,
    matchesGeoCell,
    geoCellLabel,
    type GeoCell,
    type GeoLevel,
  } from "src/util/geo"

  let element: HTMLElement
  let events: TrustedEvent[] = []
  let buffer: TrustedEvent[] = []
  let exhausted = false
  let abort = new AbortController()
  let ctrl: ReturnType<typeof makeFeedController> | null = null
  let loading = false

  let showRecorder = false
  let replyTo: {id: string; pubkey: string; relay?: string} | undefined = undefined

  // Geographic scope: same UMAP/SECTOR/REGION hierarchy the Astroport.ONE
  // journals use (0.01°/0.1°/1°) — "all" shows every voice message regardless
  // of location, the other three filter to whatever geo cell the browser's
  // own position currently falls into.
  type Scope = "all" | GeoLevel
  let activeScope: Scope = "all"
  let myUmap: GeoCell | null = null
  let locating = false
  let geoError = ""

  const scopes: Array<{id: Scope; label: string; icon: string}> = [
    {id: "all", label: "vocaux.scopeAll", icon: "fa-globe"},
    {id: "umap", label: "vocaux.scopeUmap", icon: "fa-location-dot"},
    {id: "sector", label: "vocaux.scopeSector", icon: "fa-draw-polygon"},
    {id: "region", label: "vocaux.scopeRegion", icon: "fa-map"},
  ]

  $: myCell =
    activeScope === "all" || !myUmap
      ? null
      : activeScope === "umap"
        ? myUmap
        : activeScope === "sector"
          ? toSector(myUmap)
          : toRegion(myUmap)

  const selectScope = async (scope: Scope) => {
    geoError = ""
    if (scope !== "all" && !myUmap) {
      locating = true
      try {
        myUmap = await getCurrentUmap()
      } catch (err) {
        geoError = $_("vocaux.locationFailed") || "Impossible d'obtenir la position"
        locating = false
        return
      }
      locating = false
    }
    activeScope = scope
  }

  $: activeGeoLevel = (activeScope === "all" ? "umap" : activeScope) as GeoLevel

  $: filteredEvents =
    activeScope === "all" || !myCell
      ? events
      : events.filter(e => {
          const info = extractVocalInfo(e)
          return matchesGeoCell(info.latitude, info.longitude, activeGeoLevel, myCell)
        })

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
    <!-- Geographic scope selector -->
    <div class="flex flex-wrap items-center gap-2">
      {#each scopes as s}
        <button
          class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all disabled:opacity-50"
          class:border-accent={activeScope === s.id}
          class:bg-accent={activeScope === s.id}
          class:text-white={activeScope === s.id}
          class:border-neutral-700={activeScope !== s.id}
          class:bg-neutral-800={activeScope !== s.id}
          class:text-neutral-400={activeScope !== s.id}
          disabled={locating}
          on:click={() => selectScope(s.id)}>
          {#if locating && s.id !== "all" && activeScope !== s.id}
            <i class="fa fa-spinner fa-spin" />
          {:else}
            <i class="fa {s.icon}" />
          {/if}
          {$_(s.label)}
        </button>
      {/each}
      {#if myCell}
        <span class="text-xs text-neutral-500">{geoCellLabel(activeGeoLevel, myCell)}</span>
      {/if}
    </div>
    {#if geoError}
      <p class="text-red-400 text-xs">{geoError}</p>
    {/if}

    <div class="flex flex-col gap-3">
      {#each filteredEvents as event (event.id)}
        <div in:fly={{y: 20}}>
          <VocalCard {event} onReply={openReply} />
        </div>
      {/each}
    </div>

    {#if loading && events.length === 0}
      <Spinner />
    {:else if !exhausted && events.length > 0}
      <Spinner />
    {:else if exhausted && filteredEvents.length === 0}
      <div class="py-16 text-center">
        <i class="fa fa-microphone-slash mb-3 text-5xl text-neutral-700" />
        <p class="text-neutral-400">
          {activeScope === "all"
            ? $_("vocaux.empty") || "Aucun message vocal pour l'instant."
            : $_("vocaux.emptyScope") || "Aucun message vocal géolocalisé ici pour l'instant."}
        </p>
      </div>
    {/if}
  {/if}
</FlexColumn>

{#if showRecorder}
  <VocalRecorder {replyTo} onClose={closeRecorder} {onPublished} />
{/if}
