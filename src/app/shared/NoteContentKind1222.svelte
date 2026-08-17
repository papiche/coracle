<script lang="ts">
  import ExpirationBadge from "src/app/shared/ExpirationBadge.svelte"
  import {extractVocalInfo, decryptVocalContent, type VocalPayload} from "src/util/vocals"

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
      <audio controls src={payload.url} class="w-full" preload="metadata" />
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
