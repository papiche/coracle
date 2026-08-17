<script lang="ts">
  import {_} from "svelte-i18n"
  import {onMount} from "svelte"
  import {uniqBy} from "@welshman/lib"
  import {LONG_FORM, getIdOrAddress, getTagValue, getTagValues} from "@welshman/util"
  import type {TrustedEvent} from "@welshman/util"
  import {Router} from "@welshman/router"
  import {pubkey, signer, makeFeedController} from "@welshman/app"
  import {makeIntersectionFeed, makeKindFeed, makeAuthorFeed} from "@welshman/feeds"
  import {createScroller} from "src/util/misc"
  import {fly} from "src/util/transition"
  import Feed from "src/app/shared/Feed.svelte"
  import ExpirationBadge from "src/app/shared/ExpirationBadge.svelte"
  import Tabs from "src/partials/Tabs.svelte"
  import Button from "src/partials/Button.svelte"
  import Spinner from "src/partials/Spinner.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import {userFollows, sortEventsDesc} from "src/engine"
  import {router} from "src/app/util/router"

  const tabs = ["🌐", "→", "📝"]

  let activeTab = "🌐"
  let viewMode: "grid" | "list" = "grid"

  // Grid state
  let element: HTMLElement
  let gridEvents: TrustedEvent[] = []
  let gridBuffer: TrustedEvent[] = []
  let gridExhausted = false
  let gridAbort = new AbortController()
  let gridCtrl: ReturnType<typeof makeFeedController> | null = null
  let gridLoading = false

  // Filter/search state
  let searchQuery = ""
  let filterTag = ""
  let allTags: string[] = []

  const setActiveTab = tab => {
    activeTab = tab
    filterTag = ""
    searchQuery = ""
  }

  $: authors =
    !$pubkey || activeTab === "🌐"
      ? undefined
      : activeTab === "→"
        ? [...$userFollows]
        : activeTab === "📝"
          ? [$pubkey]
          : undefined

  $: feed = authors
    ? {
        title: "Blogs",
        identifier: "blogs",
        description: "Blog feed",
        definition: makeIntersectionFeed(makeKindFeed(LONG_FORM), makeAuthorFeed(...authors)),
      }
    : {
        title: "Blogs",
        identifier: "blogs",
        description: "Blog feed",
        definition: makeIntersectionFeed(makeKindFeed(LONG_FORM)),
      }

  const loadGridEvents = () => {
    gridAbort.abort()
    gridAbort = new AbortController()
    gridEvents = []
    gridBuffer = []
    gridExhausted = false
    gridLoading = false
    allTags = []

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
    loadMoreGrid()
  }

  const loadMoreGrid = async () => {
    if (!gridCtrl || gridLoading) return
    gridLoading = true
    const ctrl = gridCtrl

    await ctrl.load(20)

    if (ctrl !== gridCtrl) {
      gridLoading = false
      return
    }

    gridBuffer = uniqBy(e => e.id, sortEventsDesc(gridBuffer))
    const newEvents = gridBuffer.splice(0, 20)
    gridEvents = [...gridEvents, ...newEvents]

    // Collect tags from loaded events
    for (const e of newEvents) {
      for (const t of getTagValues("t", e.tags)) {
        if (t && !allTags.includes(t)) allTags = [...allTags, t]
      }
    }

    gridLoading = false
  }

  $: filteredEvents = (() => {
    let events = [...gridEvents]

    // Text search on title + content
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      events = events.filter(e => {
        const title = (getTagValue("title", e.tags) || "").toLowerCase()
        const content = (e.content || "").toLowerCase()
        const summary = (getTagValue("summary", e.tags) || "").toLowerCase()
        return title.includes(q) || content.includes(q) || summary.includes(q)
      })
    }

    // Tag filter
    if (filterTag) {
      events = events.filter(e => getTagValues("t", e.tags).includes(filterTag))
    }

    return events
  })()

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

  // Format relative date
  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000)
    return d.toLocaleDateString(undefined, {year: "numeric", month: "short", day: "numeric"})
  }

  document.title = $_("menu.blog")
</script>

<FlexColumn bind:element>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <i class="fa fa-newspaper fa-lg" />
      <h2 class="staatliches text-2xl">{$_("menu.blog")}</h2>
    </div>
    <div class="flex items-center gap-2">
      <!-- View mode toggle -->
      <div class="flex overflow-hidden rounded bg-neutral-800">
        <button
          class="px-2.5 py-1.5 text-sm transition-colors"
          class:bg-accent={viewMode === "grid"}
          class:text-white={viewMode === "grid"}
          class:text-neutral-400={viewMode !== "grid"}
          on:click={() => (viewMode = "grid")}
          title="Grille">
          <i class="fa fa-th" />
        </button>
        <button
          class="px-2.5 py-1.5 text-sm transition-colors"
          class:bg-accent={viewMode === "list"}
          class:text-white={viewMode === "list"}
          class:text-neutral-400={viewMode !== "list"}
          on:click={() => (viewMode = "list")}
          title="Liste">
          <i class="fa fa-list" />
        </button>
      </div>

      <!-- Write button (only for signed-in users) -->
      {#if $signer}
        <Button class="btn btn-accent" on:click={() => router.at("blog/create").go()}>
          <i class="fa fa-pen" />
          {$_("blog.write") || "Écrire"}
        </Button>
      {/if}
    </div>
  </div>

  <!-- Tabs: Network / Follows / My articles -->
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
        placeholder={$_("blog.search") || "Rechercher un article…"}
        type="text" />
      {#if searchQuery}
        <button class="text-neutral-500 hover:text-neutral-300" on:click={() => (searchQuery = "")}>
          <i class="fa fa-times" />
        </button>
      {/if}
    </div>

    <!-- Tag filter pills -->
    {#if allTags.length > 0}
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-full border px-3 py-0.5 text-xs font-medium transition-all"
          class:border-accent={filterTag === ""}
          class:bg-accent={filterTag === ""}
          class:text-white={filterTag === ""}
          class:border-neutral-700={filterTag !== ""}
          class:text-neutral-400={filterTag !== ""}
          on:click={() => (filterTag = "")}>
          {$_("video.filterAll") || "Tous"}
        </button>
        {#each allTags.slice(0, 12) as tag}
          <button
            class="rounded-full border px-3 py-0.5 text-xs font-medium transition-all"
            class:border-accent={filterTag === tag}
            class:bg-accent={filterTag === tag}
            class:text-white={filterTag === tag}
            class:border-neutral-700={filterTag !== tag}
            class:text-neutral-400={filterTag !== tag}
            on:click={() => (filterTag = filterTag === tag ? "" : tag)}>
            #{tag}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Articles grid -->
    <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))">
      {#each filteredEvents as event (event.id)}
        {@const title = getTagValue("title", event.tags) || "Sans titre"}
        {@const summary = getTagValue("summary", event.tags) || event.content?.slice(0, 150) || ""}
        {@const image = getTagValue("image", event.tags)}
        {@const tags = getTagValues("t", event.tags)}
        {@const lat = getTagValue("latitude", event.tags)}
        {@const lon = getTagValue("longitude", event.tags)}
        <div in:fly={{y: 20}} class="min-w-0">
          <button
            class="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-transparent bg-neutral-900 text-left transition-all hover:-translate-y-0.5 hover:border-accent"
            on:click={() =>
              router
                .at("notes")
                .of(getIdOrAddress(event), {relays: Router.get().Event(event).limit(10).getUrls()})
                .open()}>
            <!-- Cover image -->
            {#if image}
              <div class="aspect-video w-full overflow-hidden bg-neutral-800">
                <img
                  src={image}
                  alt={title}
                  class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
              </div>
            {:else}
              <div
                class="flex aspect-video w-full items-center justify-center bg-neutral-800 text-4xl text-neutral-600">
                <i class="fa fa-newspaper" />
              </div>
            {/if}

            <!-- Article info -->
            <div class="flex flex-1 flex-col gap-1.5 p-3">
              <h3
                class="line-clamp-2 break-words text-sm font-semibold leading-snug text-neutral-100 group-hover:text-white">
                {title}
              </h3>

              {#if summary}
                <p class="line-clamp-2 break-words text-xs leading-relaxed text-neutral-500">
                  {summary}
                </p>
              {/if}

              <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                <span class="text-[10px] text-neutral-600">{formatDate(event.created_at)}</span>
                <ExpirationBadge tags={event.tags} />
                {#if lat && lon}
                  <span class="text-[10px] text-neutral-500" title="UMAP {lat}_{lon}">
                    <i class="fa fa-map-marker-alt" />
                  </span>
                {/if}
                {#if event.pubkey === $pubkey}
                  <span class="bg-accent/20 rounded-full px-1.5 py-0.5 text-[10px] text-accent">
                    {$_("blog.myArticle") || "Mon article"}
                  </span>
                  <!-- Edit button for own articles -->
                  <button
                    class="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400 transition-all hover:border-accent hover:text-accent"
                    on:click|stopPropagation={() =>
                      router
                        .at("blog/create")
                        .qp({address: `30023:${event.pubkey}:${getTagValue("d", event.tags)}`})
                        .go()}>
                    <i class="fa fa-edit" />
                    {$_("blog.edit") || "Modifier"}
                  </button>
                {/if}
                {#each tags.slice(0, 2) as tag}
                  <span
                    class="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                    #{tag}
                  </span>
                {/each}
              </div>
            </div>
          </button>
        </div>
      {/each}
    </div>

    {#if gridLoading && gridEvents.length === 0}
      <Spinner />
    {:else if !gridExhausted && gridEvents.length > 0}
      <Spinner />
    {:else if gridExhausted && filteredEvents.length === 0}
      <div class="py-16 text-center">
        <i class="fa fa-feather-alt mb-3 text-5xl text-neutral-700" />
        <p class="text-neutral-400">
          {activeTab === "📝"
            ? $_("blog.noMyArticles") || "Vous n'avez pas encore écrit d'articles."
            : $_("feed.empty") || "Aucun article trouvé."}
        </p>
        {#if $signer && activeTab === "📝"}
          <Button class="btn btn-accent mt-4" on:click={() => router.at("blog/create").go()}>
            <i class="fa fa-pen" />
            {$_("blog.writeFirst") || "Écrire mon premier article"}
          </Button>
        {/if}
      </div>
    {/if}
  {:else}
    <!-- List mode: use Feed component -->
    {#key `${activeTab}-list`}
      <Feed {feed} />
    {/key}
  {/if}
</FlexColumn>
