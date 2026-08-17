<script lang="ts">
  import {_} from "svelte-i18n"
  import {marked} from "marked"
  import insane from "insane"
  import {randomId} from "@welshman/lib"
  import {getTagValue, getTagValues, LONG_FORM, makeEvent} from "@welshman/util"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Button from "src/partials/Button.svelte"
  import {signAndPublish, uploadImage} from "src/engine"
  import {router} from "src/app/util/router"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import logger from "src/util/logger"

  /** Optional pre-loaded event to edit (passed via router context) */
  export let event = undefined

  // Populate fields from existing event (edit mode)
  let title = event ? getTagValue("title", event.tags) || "" : ""
  let summary = event ? getTagValue("summary", event.tags) || "" : ""
  let imageUrl = event ? getTagValue("image", event.tags) || "" : ""
  let tagsInput = event ? getTagValues("t", event.tags).join(", ") : ""
  let content = event ? event.content || "" : ""
  const identifier = event ? getTagValue("d", event.tags) || randomId() : randomId()

  // UMAP geolocation (Astroport.ONE NOSTR.UMAP.refresh.sh): a 0.01°x0.01° grid
  // cell, keyed by latitude/longitude rounded to 2 decimals.
  const existingLat = event ? getTagValue("latitude", event.tags) : ""
  const existingLon = event ? getTagValue("longitude", event.tags) : ""
  let geoEnabled = Boolean(existingLat && existingLon)
  let latitude = existingLat || ""
  let longitude = existingLon || ""
  let locating = false

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    locating = true
    navigator.geolocation.getCurrentPosition(
      pos => {
        latitude = pos.coords.latitude.toFixed(2)
        longitude = pos.coords.longitude.toFixed(2)
        locating = false
      },
      () => {
        locating = false
        showWarning($_("blog.locationFailed") || "Impossible d'obtenir la position")
      },
    )
  }

  let publishing = false
  let showPreview = false
  let uploadingImage = false
  let imageInput: HTMLInputElement

  const isEditMode = !!event

  const pickImage = () => imageInput?.click()

  const onImageSelected = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    uploadingImage = true
    try {
      imageUrl = await uploadImage(file)
    } catch (err) {
      logger.error("Failed to upload cover image:", err)
      showWarning($_("blog.imageUploadFailed") || "Échec de l'envoi de l'image")
    } finally {
      uploadingImage = false
      ;(e.target as HTMLInputElement).value = ""
    }
  }

  const renderPreview = (md: string) =>
    insane(marked.parse(md) as string, {
      allowedTags: [
        "p",
        "br",
        "b",
        "i",
        "em",
        "strong",
        "a",
        "ul",
        "ol",
        "li",
        "blockquote",
        "code",
        "pre",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "img",
        "hr",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
      ],
    })

  const publish = async () => {
    if (!title.trim()) {
      showWarning($_("blog.titleRequired") || "Le titre est requis")
      return
    }
    if (!content.trim()) {
      showWarning($_("blog.contentRequired") || "Le contenu est requis")
      return
    }

    publishing = true
    try {
      const nowSec = String(Math.floor(Date.now() / 1000))
      const tags: string[][] = [
        ["d", identifier],
        ["title", title.trim()],
        ["published_at", nowSec],
      ]
      if (summary.trim()) tags.push(["summary", summary.trim()])
      if (imageUrl.trim()) tags.push(["image", imageUrl.trim()])
      for (const tag of tagsInput
        .split(",")
        .map(t => t.trim())
        .filter(Boolean)) {
        tags.push(["t", tag])
      }
      if (geoEnabled && latitude && longitude) {
        const lat = parseFloat(latitude).toFixed(2)
        const lon = parseFloat(longitude).toFixed(2)
        tags.push(
          ["latitude", lat],
          ["longitude", lon],
          ["g", `${lat},${lon}`],
          ["application", "UPlanet"],
          ["t", "UPlanet"],
          ["t", "UMAP"],
        )
      }

      const template = makeEvent(LONG_FORM, {content: content.trim(), tags})
      await signAndPublish(template)
      showInfo($_("blog.published") || "Article publié !")
      router.at("blog").go()
    } catch (e) {
      logger.error("Failed to publish article:", e)
      showWarning($_("blog.publishFailed") || "Échec de la publication")
    } finally {
      publishing = false
    }
  }

  document.title = isEditMode
    ? $_("blog.editArticle") || "Modifier l'article"
    : $_("blog.newArticle") || "Nouvel article"
</script>

<FlexColumn>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <button
        class="text-neutral-400 transition-colors hover:text-neutral-100"
        on:click={() => router.at("blog").go()}>
        <i class="fa fa-arrow-left" />
      </button>
      <h1 class="staatliches text-2xl">
        {isEditMode
          ? $_("blog.editArticle") || "Modifier l'article"
          : $_("blog.newArticle") || "Nouvel article"}
      </h1>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-all hover:border-neutral-500"
        on:click={() => (showPreview = !showPreview)}>
        <i class="fa {showPreview ? 'fa-edit' : 'fa-eye'}" />
        {showPreview ? $_("blog.edit") || "Éditer" : $_("blog.preview") || "Aperçu"}
      </button>
      <Button on:click={publish} disabled={publishing}>
        {#if publishing}
          <i class="fa fa-spinner fa-spin" />
        {:else}
          <i class="fa fa-paper-plane" />
        {/if}
        {publishing ? $_("blog.publishing") || "Publication…" : $_("blog.publish") || "Publier"}
      </Button>
    </div>
  </div>

  <!-- Metadata fields -->
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-1 sm:col-span-2">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.title") || "Titre"} *</label>
      <input
        bind:value={title}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-accent"
        placeholder={$_("blog.titlePlaceholder") || "Mon article…"}
        type="text" />
    </div>

    <div class="flex flex-col gap-1 sm:col-span-2">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.summary") || "Résumé"}</label>
      <input
        bind:value={summary}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-accent"
        placeholder={$_("blog.summaryPlaceholder") || "Une phrase de présentation…"}
        type="text" />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400"
        >{$_("blog.coverImage") || "Image de couverture"}</label>
      <div class="flex gap-2">
        <input
          bind:value={imageUrl}
          class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-accent"
          placeholder="https://…"
          type="url" />
        <input
          bind:this={imageInput}
          on:change={onImageSelected}
          type="file"
          accept="image/*"
          class="hidden" />
        <button
          type="button"
          class="shrink-0 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 transition-all hover:border-accent hover:text-accent disabled:opacity-50"
          disabled={uploadingImage}
          on:click={pickImage}>
          {#if uploadingImage}
            <i class="fa fa-spinner fa-spin" />
          {:else}
            <i class="fa fa-upload" />
          {/if}
        </button>
      </div>
      {#if imageUrl}
        <img
          src={imageUrl}
          alt=""
          class="mt-1 h-24 w-full rounded-lg border border-neutral-700 object-cover" />
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400"
        >{$_("blog.tags") || "Tags (virgule)"}</label>
      <input
        bind:value={tagsInput}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-accent"
        placeholder="nostr, bitcoin…"
        type="text" />
    </div>

    <div class="flex flex-col gap-1 sm:col-span-2">
      <label class="flex items-center gap-2 text-xs font-medium text-neutral-400">
        <input type="checkbox" bind:checked={geoEnabled} />
        <i class="fa fa-map-marker-alt" />
        {$_("blog.geolocate") || "Publier avec géolocalisation (UMAP)"}
      </label>
      {#if geoEnabled}
        <div class="flex flex-wrap items-center gap-2">
          <input
            bind:value={latitude}
            class="w-28 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-accent"
            placeholder={$_("blog.latitude") || "Latitude"}
            type="number"
            step="0.01" />
          <input
            bind:value={longitude}
            class="w-28 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-accent"
            placeholder={$_("blog.longitude") || "Longitude"}
            type="number"
            step="0.01" />
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 transition-all hover:border-accent hover:text-accent disabled:opacity-50"
            disabled={locating}
            on:click={useMyLocation}>
            {#if locating}
              <i class="fa fa-spinner fa-spin" />
            {:else}
              <i class="fa fa-location-crosshairs" />
            {/if}
            {$_("blog.useMyLocation") || "Ma position"}
          </button>
          {#if latitude && longitude}
            <span class="text-xs text-neutral-500">
              UMAP: {parseFloat(latitude).toFixed(2)}_{parseFloat(longitude).toFixed(2)}
            </span>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Editor / Preview -->
  <div
    class="relative min-h-96 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
    {#if showPreview}
      <div class="prose prose-invert max-w-none px-6 py-5 text-sm leading-relaxed text-neutral-200">
        {#if content}
          {@html renderPreview(content)}
        {:else}
          <p class="italic text-neutral-500">
            {$_("blog.previewEmpty") || "Aucun contenu à afficher…"}
          </p>
        {/if}
      </div>
    {:else}
      <textarea
        bind:value={content}
        class="h-full min-h-96 w-full resize-none bg-transparent px-6 py-5 font-mono text-sm text-neutral-100 placeholder-neutral-600 outline-none"
        placeholder={$_("blog.contentPlaceholder") || "# Mon article\n\nÉcrivez ici en Markdown…"}
        spellcheck="false" />
    {/if}
  </div>

  <p class="text-xs text-neutral-600">
    <i class="fa fa-info-circle" />
    {$_("blog.markdownHint") ||
      "Markdown : **gras**, _italique_, # titre, [lien](url), ![img](url), `code`"}
  </p>
</FlexColumn>
