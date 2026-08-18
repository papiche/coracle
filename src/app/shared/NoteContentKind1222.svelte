<script lang="ts">
  import ExpirationBadge from "src/app/shared/ExpirationBadge.svelte"
  import {
    extractVocalInfo,
    decryptVocalContent,
    resolveBrokenVocalUrl,
    type VocalPayload,
  } from "src/util/vocals"

  export let note
  export let showEntire = false

  $: info = extractVocalInfo(note)

  const resolvePayload = (): Promise<VocalPayload> =>
    info.isEncrypted
      ? decryptVocalContent(note)
      : Promise.resolve({
          url: info.url,
          title: info.title,
          description: info.description,
          duration: info.duration,
          latitude: info.latitude,
          longitude: info.longitude,
        })

  // Some vocal messages (older recordings, or ones published outside
  // coracle) end up tagged with a URL the gateway can't resolve directly —
  // only try the uDRIVE manifest.json recovery once playback actually fails.
  let recoveredUrl: string | null = null
  let recoveryAttempted = false

  const onAudioError = async (url: string) => {
    if (recoveryAttempted) return
    recoveryAttempted = true
    const recovered = await resolveBrokenVocalUrl(url)
    if (recovered) recoveredUrl = recovered.url
  }
</script>

<div class="flex flex-col gap-2">
  {#if info.isReply}
    <div class="flex items-center gap-1 text-xs text-neutral-500">
      <i class="fa fa-reply" />
      Réponse vocale
    </div>
  {/if}
  {#await resolvePayload()}
    <p class="text-sm text-neutral-500">
      <i class="fa fa-spinner fa-spin" />
      Chargement du message vocal…
    </p>
  {:then payload}
    <div class="flex items-center gap-2">
      <i class="fa fa-microphone text-accent" />
      <span class="font-semibold text-neutral-100">{payload.title || "Message vocal"}</span>
      {#if info.isEncrypted}
        <i class="fa fa-lock text-xs text-neutral-500" title="Message privé" />
      {/if}
    </div>
    {#if payload.description}
      <p class="break-words text-sm text-neutral-400">{payload.description}</p>
    {/if}
    {#if payload.url}
      <audio
        controls
        src={recoveredUrl || payload.url}
        class="w-full"
        preload="metadata"
        on:error={() => onAudioError(payload.url)} />
    {/if}
    {#if (payload.latitude || info.latitude) && (payload.longitude || info.longitude)}
      <span class="text-xs text-neutral-500">
        <i class="fa fa-map-marker-alt" />
        UMAP {payload.latitude || info.latitude}_{payload.longitude || info.longitude}
      </span>
    {/if}
  {:catch}
    <p class="text-sm text-neutral-400">
      <i class="fa fa-lock" />
      Message vocal privé (non déchiffrable avec ce compte)
    </p>
  {/await}
  {#if showEntire}
    <ExpirationBadge tags={note.tags} />
  {/if}
</div>
