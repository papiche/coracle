<script lang="ts">
  import {_} from "svelte-i18n"
  import {pubkey, deriveProfile} from "@welshman/app"
  import {
    extractIdentitiesFromTags,
    fetchUdriveManifest,
    getUdriveFileUrl,
    type UdriveFile,
    type UdriveManifest,
  } from "src/util/zen"
  import Spinner from "src/partials/Spinner.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"

  export let onSelect: (file: UdriveFile, url: string) => void

  const profile = deriveProfile($pubkey)

  let manifest: UdriveManifest | null = null
  let loading = false
  let loadedKey: string | null = null

  // ipns_vault is only ever set as a NIP-39 "i" tag, never in the kind-0 JSON content;
  // email may appear in either.
  $: tagIdentities = extractIdentitiesFromTags($profile?.event?.tags || [])
  $: ipnsVault = tagIdentities.ipns_vault || null
  $: email = ($profile as any)?.email || tagIdentities.email || null

  $: if (ipnsVault && email && `${ipnsVault}:${email}` !== loadedKey) {
    load(ipnsVault, email)
  }

  const load = async (vault: string, userEmail: string) => {
    loading = true
    loadedKey = `${vault}:${userEmail}`
    manifest = await fetchUdriveManifest(vault, userEmail)
    loading = false
  }

  const select = (file: UdriveFile) => onSelect(file, getUdriveFileUrl(file))

  const iconFor = (type: string) => {
    if (type === "image") return "fa-image"
    if (type === "video") return "fa-video"
    if (type === "audio") return "fa-music"
    return "fa-file"
  }
</script>

<FlexColumn>
  <h2 class="staatliches text-xl">{$_("udrive.browse")}</h2>
  {#if loading}
    <Spinner />
  {:else if !ipnsVault || !email}
    <p class="text-neutral-400">{$_("udrive.notConfigured")}</p>
  {:else if !manifest || manifest.files.length === 0}
    <p class="text-neutral-400">{$_("udrive.empty")}</p>
  {:else}
    <div class="grid max-h-[60vh] gap-1 overflow-auto">
      {#each manifest.files as file (file.path)}
        <button
          type="button"
          class="flex items-center gap-3 rounded p-2 text-left transition-colors hover:bg-neutral-700"
          on:click={() => select(file)}>
          <i class="fa {iconFor(file.type)} text-neutral-400" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate">{file.name}</span>
            <span class="text-xs text-neutral-500">{file.formattedSize}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</FlexColumn>
