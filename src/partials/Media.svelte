<script lang="ts">
  import MediaAudio from "src/partials/MediaAudio.svelte"
  import MediaSpotify from "src/partials/MediaSpotify.svelte"
  import MediaTidal from "src/partials/MediaTidal.svelte"
  import MediaVideo from "src/partials/MediaVideo.svelte"
  import MediaImage from "src/partials/MediaImage.svelte"
  import MediaLinkPreview from "src/partials/MediaLinkPreview.svelte"

  export let url: string
  export let fullSize = false
  export let onLinkClick: (url: string, event: any) => void
  export let onImageClick: (url: string, event: any) => void
  // Explicit hint from a caller that already knows the media kind (e.g. a NIP-71
  // video note) — bypasses extension-sniffing, which fails for extensionless
  // IPFS URLs (.../ipfs/<CID>) and would otherwise fall through to MediaLinkPreview.
  export let type: "audio" | "video" | "image" | null = null

  const isAudio = type === "audio" || url.match(/\.(wav|mp3|m3u8)$/)
  const isSpotify = type === null && url.match(/open.spotify.com/)
  const isTidal = type === null && url.match(/tidal.com/)
  const isVideo = type === "video" || url.match(/\.(mov|webm|mp4)$/)
  const isImage = type === "image" || url.match(/\.(jpe?g|png|gif|webp)$/)

  const linkClickHandler = (event: any) => onLinkClick(url, event)
  const imageClickHandler = (event: any) => onImageClick(url, event)
</script>

<div on:click|stopPropagation class="flex justify-center">
  {#if isAudio}
    <MediaAudio {url} />
  {:else if isSpotify}
    <MediaSpotify {url} {linkClickHandler} />
  {:else if isTidal}
    <MediaTidal {url} />
  {:else if isVideo}
    <MediaVideo {url} />
  {:else if isImage}
    <a
      href={url}
      on:click|preventDefault={imageClickHandler}
      class="relative flex h-full flex-grow items-center justify-center">
      <div class="flex max-w-[95vw] flex-grow items-center justify-center overflow-hidden rounded">
        <MediaImage {url} {fullSize} />
      </div>
    </a>
  {:else}
    <a href={url} on:click|preventDefault={linkClickHandler}>
      <MediaLinkPreview {url} />
    </a>
  {/if}
</div>
