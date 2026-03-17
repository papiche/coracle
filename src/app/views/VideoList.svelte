<script lang="ts">
  import {_} from "svelte-i18n"
  import {onMount} from "svelte"
  import {uniqBy} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {makeFeedController} from "@welshman/app"
  import {pubkey, signer} from "@welshman/app"
  import {makeIntersectionFeed, makeKindFeed, makeAuthorFeed} from "@welshman/feeds"
  import {createScroller} from "src/util/misc"
  import {fly} from "src/util/transition"
  import Feed from "src/app/shared/Feed.svelte"
  import Tabs from "src/partials/Tabs.svelte"
  import Button from "src/partials/Button.svelte"
  import Spinner from "src/partials/Spinner.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import VideoCard from "src/app/shared/VideoCard.svelte"
  import {getVerifiedUPlanet} from "src/util/uplanet-detect"
  import {userFollows, sortEventsDesc} from "src/engine"

  const uplanet = getVerifiedUPlanet()
  const tabs = ["🌐", "→"]

  let activeTab = "🌐"
  let viewMode: "grid" | "list" = "grid"

  // Grid mode state
  let element: HTMLElement
  let gridEvents: TrustedEvent[] = []
  let gridBuffer: TrustedEvent[] = []
  let gridExhausted = false
  let gridAbort = new AbortController()
  let gridCtrl: ReturnType<typeof makeFeedController> | null = null
  let gridLoading = false

  // Search/filter/sort state
  let searchQuery = ""
  type SourceFilter = "all" | "local" | "youtube" | "film" | "serie" | "short"
  let sourceFilter: SourceFilter = "all"
  let sortOrder: "desc" | "asc" = "desc"

  // Filter button definitions (typed constant so template `{#each}` infers the union correctly)
  const sourceFilters: Array<{id: SourceFilter; label: string; icon: string}> = [
    {id: "all",     label: "video.filterAll",   icon: "fa-globe"},
    {id: "local",   label: "video.filterLocal", icon: "fa-broadcast-tower"},
    {id: "youtube", label: "__youtube__",       icon: "fa-youtube"},
    {id: "film",    label: "video.filterFilm",  icon: "fa-film"},
    {id: "serie",   label: "video.filterSerie", icon: "fa-tv"},
    {id: "short",   label: "video.filterShort", icon: "fa-bolt"},
  ]

  const filterLabel = (f: {id: SourceFilter; label: string}) =>
    f.label === "__youtube__" ? "YouTube" : ($_(`${f.label}`) || f.label.split(".").pop() || f.label)

  /** Detect the source type of a video event (same logic as VideoCard) */
  const getSourceType = (e: TrustedEvent): string => {
    const src = e.tags.find(t => t[0] === "i" && t[1]?.startsWith("source:"))
    if (src) return src[1].replace("source:", "")
    if (e.tags.some(t => t[0] === "t" && t[1] === "youtube")) return "youtube"
    if (e.tags.some(t => t[0] === "t" && t[1] === "film")) return "film"
    if (e.tags.some(t => t[0] === "t" && t[1] === "serie")) return "serie"
    if (e.tags.some(t => t[0] === "t" && ["webcam", "local", "nostr"].includes(t[1]))) return "local"
    return "local" // default: locally-published
  }

  const getDuration = (e: TrustedEvent): number =>
    parseInt(e.tags.find(t => t[0] === "duration")?.[1] || "0")

  const setActiveTab = tab => {
    activeTab = tab
  }

  $: authors =
    !$pubkey || activeTab === "🌐"
      ? undefined
      : activeTab === "→"
        ? [...$userFollows]
        : undefined

  $: feed = authors
    ? {title: "Videos", identifier: "videos", description: "Video feed", definition: makeIntersectionFeed(makeKindFeed(21, 22), makeAuthorFeed(...authors))}
    : {title: "Videos", identifier: "videos", description: "Video feed", definition: makeIntersectionFeed(makeKindFeed(21, 22))}

  const loadGridEvents = () => {
    gridAbort.abort()
    gridAbort = new AbortController()
    gridEvents = []
    gridBuffer = []
    gridExhausted = false
    gridLoading = false

    gridCtrl = makeFeedController({
      feed: feed.definition,
      useWindowing: true,
      signal: gridAbort.signal,
      onEvent: e => {
        gridBuffer.push(e)
      },
      onExhausted: () => {
        gridExhausted = true
        gridLoading = false
      },
    })

    // Trigger initial load
    loadMoreGrid()
  }

  const loadMoreGrid = async () => {
    if (!gridCtrl || gridLoading) return
    gridLoading = true

    // Capture current controller reference to detect stale loads
    const ctrl = gridCtrl

    // Load a batch of events from the network
    await ctrl.load(20)

    // Discard results if the controller has been replaced (tab/feed change)
    if (ctrl !== gridCtrl) {
      gridLoading = false
      return
    }

    // Move buffered events to displayed list
    gridBuffer = uniqBy(e => e.id, sortEventsDesc(gridBuffer))
    gridEvents = [...gridEvents, ...gridBuffer.splice(0, 20)]

    gridLoading = false
  }

  $: filteredEvents = (() => {
    let events = [...gridEvents]

    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      events = events.filter(e => {
        const title = (e.tags.find(t => t[0] === "title")?.[1] || "").toLowerCase()
        const content = (e.content || "").toLowerCase()
        return title.includes(q) || content.includes(q)
      })
    }

    // Source filter
    if (sourceFilter !== "all") {
      events = events.filter(e => {
        if (sourceFilter === "short") {
          const dur = getDuration(e)
          return e.kind === 22 || (dur > 0 && dur <= 60)
        }
        return getSourceType(e) === sourceFilter
      })
    }

    // Sort order (grid events arrive desc by default from the relay)
    if (sortOrder === "asc") {
      events = [...events].sort((a, b) => a.created_at - b.created_at)
    }

    return events
  })()

  // Reload when feed changes (tab switch) or when switching to grid mode
  $: if (viewMode === "grid" && feed) {
    loadGridEvents()
  }

  onMount(() => {
    const scroller = createScroller(loadMoreGrid, {element, delay: 300, threshold: 3000})
    return () => {
      scroller.stop()
      gridAbort.abort()
    }
  })

  document.title = $_("menu.video")
</script>

<FlexColumn bind:element>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <i class="fa fa-video fa-lg" />
      <h2 class="staatliches text-2xl">{$_("menu.video")}</h2>
    </div>
    <div class="flex items-center gap-2">
      <div class="flex overflow-hidden rounded bg-neutral-800">
        <button
          class="px-2.5 py-1.5 text-sm transition-colors"
          class:bg-accent={viewMode === "grid"}
          class:text-white={viewMode === "grid"}
          class:text-neutral-400={viewMode !== "grid"}
          on:click={() => (viewMode = "grid")}
          title="Grid">
          <i class="fa fa-th" />
        </button>
        <button
          class="px-2.5 py-1.5 text-sm transition-colors"
          class:bg-accent={viewMode === "list"}
          class:text-white={viewMode === "list"}
          class:text-neutral-400={viewMode !== "list"}
          on:click={() => (viewMode = "list")}
          title="List">
          <i class="fa fa-list" />
        </button>
      </div>
      {#if uplanet && $signer}
        <Button
          class="btn btn-accent"
          on:click={() => window.open(`${uplanet.apiUrl}/webcam?html=1`, "_blank")}>
          <i class="fa fa-plus" /> {$_("video.publish")}
        </Button>
      {/if}
    </div>
  </div>
  {#if $pubkey}
    <Tabs {tabs} {activeTab} {setActiveTab} />
  {/if}
  {#if viewMode === "grid"}
    <!-- Search bar -->
    <div class="flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2">
      <i class="fa fa-search text-neutral-500" />
      <input
        bind:value={searchQuery}
        class="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none"
        placeholder={$_("video.search") || "Rechercher une vidéo..."}
        type="text" />
      {#if searchQuery}
        <button class="text-neutral-500 hover:text-neutral-300" on:click={() => (searchQuery = "")}>
          <i class="fa fa-times" />
        </button>
      {/if}
    </div>

    <!-- Source & duration filters (inspired by nostr.html tube-filters + youtube.html) -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- Source filter chips -->
      {#each sourceFilters as f}
        <button
          class="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all"
          class:border-accent={sourceFilter === f.id}
          class:bg-accent={sourceFilter === f.id}
          class:text-white={sourceFilter === f.id}
          class:border-neutral-700={sourceFilter !== f.id}
          class:bg-neutral-800={sourceFilter !== f.id}
          class:text-neutral-400={sourceFilter !== f.id}
          on:click={() => (sourceFilter = f.id)}>
          <i class="fa {f.icon}" />
          {filterLabel(f)}
        </button>
      {/each}

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Sort order -->
      <button
        class="flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all"
        class:border-accent={sortOrder === "desc"}
        class:bg-neutral-800={true}
        class:text-neutral-300={true}
        title="Trier par date"
        on:click={() => (sortOrder = sortOrder === "desc" ? "asc" : "desc")}>
        <i class="fa fa-clock" />
        {sortOrder === "desc" ? "Récent ↓" : "Ancien ↑"}
      </button>
    </div>
  {/if}
  {#key `${activeTab}-${viewMode}`}
    {#if viewMode === "list"}
      <Feed {feed} />
    {:else}
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
        {#each filteredEvents as event (event.id)}
          <div in:fly={{y: 20}}>
            <VideoCard {event} />
          </div>
        {/each}
      </div>
      {#if gridLoading && gridEvents.length === 0}
        <Spinner />
      {:else if !gridExhausted && gridEvents.length > 0}
        <Spinner />
      {:else if gridExhausted && filteredEvents.length === 0}
        <p class="py-12 text-center text-neutral-400">{$_("feed.empty")}</p>
      {/if}
    {/if}
  {/key}
</FlexColumn>
