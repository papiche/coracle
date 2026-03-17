<script lang="ts">
  import {_} from "svelte-i18n"
  import {marked} from "marked"
  import insane from "insane"
  import {randomId} from "@welshman/lib"
  import {getTagValue, getTagValues, LONG_FORM, makeEvent} from "@welshman/util"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Button from "src/partials/Button.svelte"
  import {signAndPublish} from "src/engine"
  import {router} from "src/app/util/router"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import logger from "src/util/logger"

  /** Optional pre-loaded event to edit (passed via router context) */
  export let event = undefined

  // Populate fields from existing event (edit mode)
  let title = event ? (getTagValue("title", event.tags) || "") : ""
  let summary = event ? (getTagValue("summary", event.tags) || "") : ""
  let imageUrl = event ? (getTagValue("image", event.tags) || "") : ""
  let tagsInput = event
    ? getTagValues("t", event.tags).join(", ")
    : ""
  let content = event ? (event.content || "") : ""
  const identifier = event ? (getTagValue("d", event.tags) || randomId()) : randomId()

  let publishing = false
  let showPreview = false

  const isEditMode = !!event

  const renderPreview = (md: string) =>
    insane(marked.parse(md) as string, {
      allowedTags: [
        "p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li",
        "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
        "img", "hr", "table", "thead", "tbody", "tr", "th", "td",
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
      for (const tag of tagsInput.split(",").map(t => t.trim()).filter(Boolean)) {
        tags.push(["t", tag])
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
    ? ($_("blog.editArticle") || "Modifier l'article")
    : ($_("blog.newArticle") || "Nouvel article")
</script>

<FlexColumn>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <button
        class="text-neutral-400 hover:text-neutral-100 transition-colors"
        on:click={() => router.at("blog").go()}>
        <i class="fa fa-arrow-left" />
      </button>
      <h1 class="staatliches text-2xl">
        {isEditMode
          ? ($_("blog.editArticle") || "Modifier l'article")
          : ($_("blog.newArticle") || "Nouvel article")}
      </h1>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-all hover:border-neutral-500"
        on:click={() => (showPreview = !showPreview)}>
        <i class="fa {showPreview ? 'fa-edit' : 'fa-eye'}" />
        {showPreview ? ($_("blog.edit") || "Éditer") : ($_("blog.preview") || "Aperçu")}
      </button>
      <Button on:click={publish} disabled={publishing}>
        {#if publishing}
          <i class="fa fa-spinner fa-spin" />
        {:else}
          <i class="fa fa-paper-plane" />
        {/if}
        {publishing
          ? ($_("blog.publishing") || "Publication…")
          : ($_("blog.publish") || "Publier")}
      </Button>
    </div>
  </div>

  <!-- Metadata fields -->
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="flex flex-col gap-1 sm:col-span-2">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.title") || "Titre"} *</label>
      <input
        bind:value={title}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder-neutral-600 focus:border-accent"
        placeholder={$_("blog.titlePlaceholder") || "Mon article…"}
        type="text" />
    </div>

    <div class="flex flex-col gap-1 sm:col-span-2">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.summary") || "Résumé"}</label>
      <input
        bind:value={summary}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder-neutral-600 focus:border-accent"
        placeholder={$_("blog.summaryPlaceholder") || "Une phrase de présentation…"}
        type="text" />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.coverImage") || "Image de couverture (URL)"}</label>
      <input
        bind:value={imageUrl}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder-neutral-600 focus:border-accent"
        placeholder="https://…"
        type="url" />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.tags") || "Tags (virgule)"}</label>
      <input
        bind:value={tagsInput}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder-neutral-600 focus:border-accent"
        placeholder="nostr, bitcoin…"
        type="text" />
    </div>
  </div>

  <!-- Editor / Preview -->
  <div class="relative min-h-96 rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden">
    {#if showPreview}
      <div class="prose prose-invert max-w-none px-6 py-5 text-sm leading-relaxed text-neutral-200">
        {#if content}
          {@html renderPreview(content)}
        {:else}
          <p class="italic text-neutral-500">{$_("blog.previewEmpty") || "Aucun contenu à afficher…"}</p>
        {/if}
      </div>
    {:else}
      <textarea
        bind:value={content}
        class="h-full min-h-96 w-full resize-none bg-transparent px-6 py-5 font-mono text-sm text-neutral-100 outline-none placeholder-neutral-600"
        placeholder={$_("blog.contentPlaceholder") || "# Mon article\n\nÉcrivez ici en Markdown…"}
        spellcheck="false" />
    {/if}
  </div>

  <p class="text-xs text-neutral-600">
    <i class="fa fa-info-circle" />
    {$_("blog.markdownHint") || "Markdown : **gras**, _italique_, # titre, [lien](url), ![img](url), `code`"}
  </p>
</FlexColumn>
