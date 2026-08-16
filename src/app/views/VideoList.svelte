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
  import Button from "src/partials/Button.svelte"
  import Spinner from "src/partials/Spinner.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import VideoCard from "src/app/shared/VideoCard.svelte"
  import {getVerifiedUPlanet} from "src/util/uplanet-detect"
  import {extractVideoInfo, cleanVideoTitle} from "src/util/video"
  import {userFollows, sortEventsDesc} from "src/engine"

  const uplanet = getVerifiedUPlanet()

  type Scope = "all" | "follows"
  let activeScope: Scope = "all"
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
  type SortOrder = "desc" | "asc" | "alpha"
  let sortOrder: SortOrder = "desc"
  const sortCycle: Record<SortOrder, SortOrder> = {desc: "asc", asc: "alpha", alpha: "desc"}
  const sortIcon: Record<SortOrder, string> = {
    desc: "fa-clock",
    asc: "fa-clock",
    alpha: "fa-sort-alpha-down",
  }

  // Filter button definitions (typed constant so template `{#each}` infers the union correctly)
  const sourceFilters: Array<{id: SourceFilter; label: string; icon: string}> = [
    {id: "all", label: "video.filterAll", icon: "fa-globe"},
    {id: "local", label: "video.filterLocal", icon: "fa-broadcast-tower"},
    {id: "youtube", label: "__youtube__", icon: "fa-youtube"},
    {id: "film", label: "video.filterFilm", icon: "fa-film"},
    {id: "serie", label: "video.filterSerie", icon: "fa-tv"},
    {id: "short", label: "video.filterShort", icon: "fa-bolt"},
  ]

  const filterLabel = (f: {id: SourceFilter; label: string}) =>
    f.label === "__youtube__" ? "YouTube" : $_(`${f.label}`) || f.label.split(".").pop() || f.label

  $: authors = !$pubkey || activeScope === "all" ? undefined : [...$userFollows]

  $: feed = authors
    ? {
        title: "Videos",
        identifier: "videos",
        description: "Video feed",
        definition: makeIntersectionFeed(makeKindFeed(21, 22), makeAuthorFeed(...authors)),
      }
    : {
        title: "Videos",
        identifier: "videos",
        description: "Video feed",
        definition: makeIntersectionFeed(makeKindFeed(21, 22)),
      }

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
        const info = extractVideoInfo(e)
        if (sourceFilter === "short") {
          return e.kind === 22 || (info.duration > 0 && info.duration <= 60)
        }
        return info.sourceType === sourceFilter
      })
    }

    // Sort order (grid events arrive desc by default from the relay)
    if (sortOrder === "asc") {
      events = [...events].sort((a, b) => a.created_at - b.created_at)
    } else if (sortOrder === "alpha") {
      events = [...events].sort((a, b) =>
        cleanVideoTitle(extractVideoInfo(a)).localeCompare(cleanVideoTitle(extractVideoInfo(b))),
      )
    }

    return events
  })()

  // Series grouped by name, episodes sorted by season then episode number —
  // makes a show binge-watchable instead of scattered across the flat grid.
  $: seriesGroups = (() => {
    if (sourceFilter !== "serie") return []

    const bySeries = new Map<
      string,
      {event: TrustedEvent; info: ReturnType<typeof extractVideoInfo>}[]
    >()
    for (const event of filteredEvents) {
      const info = extractVideoInfo(event)
      const key = info.seriesName || cleanVideoTitle(info)
      if (!bySeries.has(key)) bySeries.set(key, [])
      bySeries.get(key).push({event, info})
    }

    return Array.from(bySeries.entries())
      .map(([name, items]) => {
        items.sort((a, b) => {
          const seasonDiff = (a.info.seasonNumber ?? 0) - (b.info.seasonNumber ?? 0)
          if (seasonDiff !== 0) return seasonDiff
          return (a.info.episodeNumber ?? 0) - (b.info.episodeNumber ?? 0)
        })

        const episodes = items.map(i => i.event)
        const bySeason = new Map<number, TrustedEvent[]>()
        for (const item of items) {
          const season = item.info.seasonNumber ?? 0
          if (!bySeason.has(season)) bySeason.set(season, [])
          bySeason.get(season).push(item.event)
        }
        const seasons = Array.from(bySeason.entries())
          .sort(([a], [b]) => a - b)
          .map(([number, seasonEpisodes]) => ({number, episodes: seasonEpisodes}))

        return {name, episodes, seasons}
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  })()

  // Films grouped by primary genre (first non-structural "t" tag), alphabetical within each group.
  $: filmGroups = (() => {
    if (sourceFilter !== "film") return []

    const byGenre = new Map<string, TrustedEvent[]>()
    for (const event of filteredEvents) {
      const info = extractVideoInfo(event)
      const key = info.genres[0] || $_("video.genreOther") || "Autre"
      if (!byGenre.has(key)) byGenre.set(key, [])
      byGenre.get(key).push(event)
    }

    return Array.from(byGenre.entries())
      .map(([name, films]) => ({
        name,
        films: films.sort((a, b) =>
          cleanVideoTitle(extractVideoInfo(a)).localeCompare(cleanVideoTitle(extractVideoInfo(b))),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
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
          <i class="fa fa-plus" />
          {$_("video.publish")}
        </Button>
      {/if}
    </div>
  </div>
  {#if $pubkey}
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all"
        class:border-accent={activeScope === "all"}
        class:bg-accent={activeScope === "all"}
        class:text-white={activeScope === "all"}
        class:border-neutral-700={activeScope !== "all"}
        class:bg-neutral-800={activeScope !== "all"}
        class:text-neutral-400={activeScope !== "all"}
        on:click={() => (activeScope = "all")}>
        <i class="fa fa-globe" />
        {$_("video.scopeAll")}
      </button>
      <button
        class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all"
        class:border-accent={activeScope === "follows"}
        class:bg-accent={activeScope === "follows"}
        class:text-white={activeScope === "follows"}
        class:border-neutral-700={activeScope !== "follows"}
        class:bg-neutral-800={activeScope !== "follows"}
        class:text-neutral-400={activeScope !== "follows"}
        on:click={() => (activeScope = "follows")}>
        <i class="fa fa-user-friends" />
        {$_("video.scopeFollows")}
      </button>
    </div>
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

      <!-- Sort order: cycles Récent → Ancien → Alphabétique -->
      <button
        class="flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300 transition-all"
        title={$_("video.sort")}
        on:click={() => (sortOrder = sortCycle[sortOrder])}>
        <i class="fa {sortIcon[sortOrder]}" />
        {sortOrder === "desc"
          ? $_("video.sortRecent") + " ↓"
          : sortOrder === "asc"
            ? $_("video.sortOldest") + " ↑"
            : $_("video.sortAlpha")}
      </button>
    </div>
  {/if}
  {#key `${activeScope}-${viewMode}`}
    {#if viewMode === "list"}
      <Feed {feed} />
    {:else if sourceFilter === "serie"}
      <!-- Grouped by series name, episodes ordered by season/episode -->
      {#each seriesGroups as group (group.name)}
        <div class="mb-5">
          <div class="mb-2 flex min-w-0 items-center gap-2">
            <i class="fa fa-tv text-purple-400 shrink-0" />
            <h3 class="min-w-0 break-words text-base font-bold text-neutral-100">{group.name}</h3>
            <span class="shrink-0 text-xs text-neutral-500">
              {group.episodes.length}
              {group.episodes.length > 1 ? $_("video.episodes") : $_("video.episode")}
            </span>
          </div>
          {#each group.seasons as season (season.number)}
            {#if group.seasons.length > 1}
              <div class="mb-1 mt-2 text-xs font-semibold uppercase text-neutral-500">
                {$_("video.season")}
                {season.number}
              </div>
            {/if}
            <div
              class="grid gap-3"
              style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
              {#each season.episodes as event (event.id)}
                <div in:fly={{y: 20}} class="min-w-0">
                  <VideoCard
                    {event}
                    events={group.episodes}
                    index={group.episodes.indexOf(event)} />
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/each}
      {#if gridExhausted && seriesGroups.length === 0}
        <p class="py-12 text-center text-neutral-400">{$_("feed.empty")}</p>
      {/if}
    {:else if sourceFilter === "film"}
      <!-- Grouped by primary genre, alphabetical within each group -->
      {#each filmGroups as group (group.name)}
        <div class="mb-5">
          <div class="mb-2 flex min-w-0 items-center gap-2">
            <i class="fa fa-film text-blue-400 shrink-0" />
            <h3 class="min-w-0 break-words text-base font-bold capitalize text-neutral-100">
              {group.name}
            </h3>
            <span class="shrink-0 text-xs text-neutral-500">{group.films.length}</span>
          </div>
          <div
            class="grid gap-3"
            style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
            {#each group.films as event (event.id)}
              <div in:fly={{y: 20}} class="min-w-0">
                <VideoCard {event} events={group.films} index={group.films.indexOf(event)} />
              </div>
            {/each}
          </div>
        </div>
      {/each}
      {#if gridExhausted && filmGroups.length === 0}
        <p class="py-12 text-center text-neutral-400">{$_("feed.empty")}</p>
      {/if}
    {:else}
      <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
        {#each filteredEvents as event, i (event.id)}
          <div in:fly={{y: 20}} class="min-w-0">
            <VideoCard {event} events={filteredEvents} index={i} />
          </div>
        {/each}
      </div>
      {#if gridExhausted && filteredEvents.length === 0}
        <p class="py-12 text-center text-neutral-400">{$_("feed.empty")}</p>
      {/if}
    {/if}
    {#if viewMode === "grid"}
      {#if gridLoading && gridEvents.length === 0}
        <Spinner />
      {:else if !gridExhausted && gridEvents.length > 0}
        <Spinner />
      {/if}
    {/if}
  {/key}
</FlexColumn>
