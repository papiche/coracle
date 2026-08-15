<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {displayProfileByPubkey} from "@welshman/app"
  import {imgproxy} from "src/engine"
  import {router} from "src/app/util/router"
  import {extractVideoInfo} from "src/util/video"
  import ExpirationBadge from "src/app/shared/ExpirationBadge.svelte"

  export let event: TrustedEvent
  // Sibling videos + this card's position among them, so the theater can offer prev/next.
  export let events: TrustedEvent[] = [event]
  export let index = 0

  const info = extractVideoInfo(event)
  const title = info.title
  const thumbUrl = info.thumbUrl
  const gifanimUrl = info.gifanimUrl
  const duration = info.duration
  const isShort = info.isShort
  const sourceType = info.sourceType
  const description = getDescriptionTag(event) || event.content?.slice(0, 200) || ""

  function getDescriptionTag(e: TrustedEvent) {
    for (const key of ["description", "summary", "alt"]) {
      const val = e.tags.find(t => t[0] === key)?.[1]
      if (val) return val
    }
    return ""
  }

  // Collect hashtags from "t" tags (max 3 displayed)
  const hashtags = event.tags
    .filter(t => t[0] === "t" && t[1])
    .map(t => t[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3)

  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    return `${m}:${String(sec).padStart(2, "0")}`
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000)
    const now = new Date()
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diff < 60) return `${diff}s`
    if (diff < 3600) return `${Math.floor(diff / 60)}min`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    if (diff < 2592000) return `${Math.floor(diff / 86400)}j`
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} mois`
    return `${Math.floor(diff / 31536000)} an${Math.floor(diff / 31536000) > 1 ? "s" : ""}`
  }

  const authorDisplay = displayProfileByPubkey(event.pubkey)

  // Open the fullscreen theater (video player + like/reply actions), with
  // prev/next navigation across the sibling video list this card belongs to.
  const openNote = () => {
    router.at("video-theater").of(event.id).cx({events, index}).open({overlay: true})
  }

  const openProfile = (e: MouseEvent) => {
    e.stopPropagation()
    router.at("people").of(event.pubkey).open()
  }
</script>

<button
  class="group flex cursor-pointer flex-col overflow-visible rounded-xl border border-transparent bg-transparent transition-all"
  on:click={openNote}>
  <!-- Thumbnail 16:9 -->
  <div class="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-900">
    {#if thumbUrl}
      <img
        src={imgproxy(thumbUrl, {w: 400, h: 225})}
        alt={title}
        class={`h-full w-full object-cover transition-transform duration-200${gifanimUrl ? " group-hover:opacity-0" : " group-hover:scale-105"}`} />
      {#if gifanimUrl}
        <img
          src={gifanimUrl}
          alt=""
          class="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100" />
      {/if}
    {:else}
      <div class="flex h-full items-center justify-center text-3xl text-neutral-600">
        <i class="fa fa-video" />
      </div>
    {/if}

    <!-- Play icon overlay on hover -->
    <div
      class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 opacity-0 transition-opacity group-hover:opacity-100">
      <div
        class="flex h-12 w-12 items-center justify-center rounded-full bg-white bg-opacity-90 pl-1">
        <i class="fa fa-play text-lg text-black" />
      </div>
    </div>

    <!-- Duration badge -->
    {#if duration > 0}
      <span
        class="absolute bottom-1.5 right-1.5 rounded bg-black bg-opacity-80 px-1.5 py-0.5 text-xs font-medium text-white">
        {formatDuration(duration)}
      </span>
    {/if}

    <!-- Short badge -->
    {#if isShort}
      <span
        class="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
        Short
      </span>
    {/if}

    <!-- Source badge (top-right, only when no duration) -->
    {#if sourceType && duration === 0}
      <span
        class="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-xs font-semibold text-white"
        class:bg-red-600={sourceType === "youtube"}
        class:bg-blue-600={sourceType === "film"}
        class:bg-purple-600={sourceType === "serie"}
        class:bg-neutral-600={!["youtube", "film", "serie"].includes(sourceType)}>
        {sourceType}
      </span>
    {/if}
  </div>

  <!-- Info below thumbnail (YouTube-style) -->
  <div class="flex flex-col gap-0.5 py-2 text-left">
    <!-- Title (2 lines max) -->
    <span
      class="line-clamp-2 break-words text-sm font-medium leading-snug text-neutral-100 group-hover:text-white">
      {title}
    </span>

    <!-- Author + date -->
    <div class="flex items-center gap-1.5 text-xs text-neutral-400">
      <button class="truncate transition-colors hover:text-accent" on:click={openProfile}>
        {authorDisplay}
      </button>
      <span>·</span>
      <span class="shrink-0">{formatDate(event.created_at)}</span>
      <ExpirationBadge tags={event.tags} />
      {#if sourceType}
        <span>·</span>
        <span
          class="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold text-white"
          class:bg-red-600={sourceType === "youtube"}
          class:bg-blue-600={sourceType === "film"}
          class:bg-purple-600={sourceType === "serie"}
          class:bg-neutral-600={!["youtube", "film", "serie"].includes(sourceType)}>
          {sourceType}
        </span>
      {/if}
    </div>

    <!-- Description (2 lines, like youtube.html) -->
    {#if description}
      <p class="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-neutral-500">
        {description}
      </p>
    {/if}

    <!-- Hashtags -->
    {#if hashtags.length > 0}
      <div class="mt-1 flex flex-wrap gap-1">
        {#each hashtags as tag}
          <span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
            #{tag}
          </span>
        {/each}
      </div>
    {/if}
  </div>
</button>
