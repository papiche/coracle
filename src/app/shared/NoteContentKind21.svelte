<script lang="ts">
  import {imgproxy} from "src/engine"
  import {router} from "src/app/util/router"
  import {extractVideoInfo} from "src/util/video"

  export let note
  export let showMedia = false

  $: info = extractVideoInfo(note)
  $: title = info.title
  $: effectiveVideoUrl = info.videoUrl
  // thumbUrl for imgproxy (static optimised image); gifanimUrl shown raw for animation.
  $: staticPreviewUrl = info.thumbUrl
  $: gifanimUrl = info.gifanimUrl
  $: duration = info.duration
  $: isShort = info.isShort
  $: topics = info.genres

  const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  const openVideo = (e: MouseEvent) => {
    if (e.metaKey) return window.open(effectiveVideoUrl, "_blank")
    if (effectiveVideoUrl) {
      router
        .at("video-theater")
        .of(note.id)
        .cx({events: [note], index: 0})
        .open({overlay: true})
    }
  }
</script>

<div class="flex flex-col gap-2 overflow-hidden">
  <div class="flex items-start gap-2">
    {#if title}
      <h3 class="flex-1 text-lg font-bold">{title}</h3>
    {/if}
    {#if duration > 0}
      <span class="whitespace-nowrap rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
        {isShort ? "Short" : "Video"} · {formatDuration(duration)}
      </span>
    {/if}
  </div>

  {#if showMedia && (gifanimUrl || staticPreviewUrl)}
    <!-- Thumbnail/GIF preview — click to open video in modal -->
    <button
      class="group relative w-full cursor-pointer overflow-hidden rounded"
      on:click|stopPropagation={openVideo}>
      {#if staticPreviewUrl}
        <!-- Static thumbnail via imgproxy for optimisation -->
        <img
          src={imgproxy(staticPreviewUrl)}
          alt={title}
          class={`h-auto max-h-96 w-full object-cover transition-opacity duration-200${gifanimUrl ? " group-hover:opacity-0" : ""}`} />
      {/if}
      {#if gifanimUrl}
        <!-- Animated GIF shown raw — NOT through imgproxy which would strip animation -->
        <img
          src={gifanimUrl}
          alt=""
          class={`${staticPreviewUrl ? "absolute inset-0 " : ""}h-auto max-h-96 w-full object-cover${staticPreviewUrl ? " opacity-0 transition-opacity duration-200 group-hover:opacity-100" : ""}`} />
      {/if}
      <div
        class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 transition-opacity hover:bg-opacity-10">
        <i class="fa fa-play-circle text-5xl text-white drop-shadow-lg" />
      </div>
    </button>
  {:else if showMedia && effectiveVideoUrl}
    <!-- No preview available — show video player directly -->
    <video
      controls
      preload="metadata"
      src={effectiveVideoUrl}
      on:click|stopPropagation
      class="max-h-96 w-full rounded object-contain" />
  {/if}

  {#if note.content}
    <p class="text-neutral-100">{note.content}</p>
  {/if}

  {#if topics.length > 0}
    <div class="flex flex-wrap gap-1">
      {#each topics as topic}
        <span class="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">#{topic}</span>
      {/each}
    </div>
  {/if}
</div>
