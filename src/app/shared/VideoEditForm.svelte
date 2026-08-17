<script lang="ts">
  import {_} from "svelte-i18n"
  import type {TrustedEvent} from "@welshman/util"
  import {makeEvent} from "@welshman/util"
  import {Router, addMinimalFallbacks} from "@welshman/router"
  import {publishThunk, waitForThunkCompletion, getThunkError} from "@welshman/app"
  import Modal from "src/partials/Modal.svelte"
  import Button from "src/partials/Button.svelte"
  import {sign} from "src/engine/state"
  import {deleteEvent} from "src/engine"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import logger from "src/util/logger"
  import {
    extractVideoInfo,
    videoInfoToEditFields,
    buildEditedVideoTags,
    buildEditedVideoContent,
    type VideoEditFields,
  } from "src/util/video"

  export let event: TrustedEvent
  export let onClose: () => void
  export let onSaved: (newEvent: TrustedEvent) => void

  const info = extractVideoInfo(event)
  const fields: VideoEditFields = videoInfoToEditFields(info, event.content || "")
  let saving = false

  const save = async () => {
    if (!fields.title.trim()) {
      showWarning($_("videoEdit.titleRequired") || "Le titre est requis")
      return
    }

    saving = true
    try {
      const tags = buildEditedVideoTags(event.tags, fields)
      const content = buildEditedVideoContent(fields.title.trim(), fields.description.trim())
      // kind 21/22 are regular (non-addressable) events — there's no in-place
      // edit at the protocol level. Reusing created_at keeps the corrected
      // event roughly in its original chronological slot in date-sorted feeds.
      const template = makeEvent(event.kind, {content, tags, created_at: event.created_at})
      const signedEvent = await sign(template)

      const thunk = publishThunk({
        event: signedEvent,
        relays: Router.get().PublishEvent(signedEvent).policy(addMinimalFallbacks).getUrls(),
      })
      await waitForThunkCompletion(thunk)

      const error = getThunkError(thunk)
      if (error) throw new Error(error)

      // Existing likes/comments stay attached to the original event id —
      // kind 21/22 can't be edited in place, only replaced.
      deleteEvent(event)

      onSaved(signedEvent)
      showInfo($_("videoEdit.saved") || "Vidéo mise à jour !")
      onClose()
    } catch (err) {
      logger.error("Failed to save video edits:", err)
      showWarning(
        (err as Error)?.message || $_("videoEdit.saveFailed") || "Échec de la mise à jour",
      )
    } finally {
      saving = false
    }
  }
</script>

<Modal onEscape={onClose}>
  <div class="flex flex-col gap-4 p-2">
    <h2 class="staatliches text-xl">{$_("videoEdit.title") || "Modifier la vidéo"}</h2>
    <p class="text-xs text-neutral-500">
      {$_("videoEdit.hint") ||
        "Les likes et commentaires existants resteront attachés à la publication d'origine."}
    </p>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.title") || "Titre"} *</label>
      <input
        bind:value={fields.title}
        disabled={saving}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
        type="text" />
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400">{$_("blog.summary") || "Résumé"}</label>
      <input
        bind:value={fields.description}
        disabled={saving}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
        type="text" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400"
          >{$_("videoEdit.seriesName") || "Nom de la série"}</label>
        <input
          bind:value={fields.seriesName}
          disabled={saving}
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
          type="text" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400"
          >{$_("videoEdit.episodeName") || "Nom de l'épisode"}</label>
        <input
          bind:value={fields.episodeName}
          disabled={saving}
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
          type="text" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400"
          >{$_("videoEdit.season") || "Saison"}</label>
        <input
          bind:value={fields.seasonNumber}
          disabled={saving}
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
          type="number" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400"
          >{$_("videoEdit.episode") || "Épisode"}</label>
        <input
          bind:value={fields.episodeNumber}
          disabled={saving}
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
          type="number" />
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <label class="text-xs font-medium text-neutral-400"
        >{$_("blog.tags") || "Genres (virgule)"}</label>
      <input
        bind:value={fields.genres}
        disabled={saving}
        class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
        placeholder="action, science-fiction…"
        type="text" />
    </div>

    <div class="flex justify-end gap-2">
      <Button class="btn" disabled={saving} on:click={onClose}>
        {$_("videoEdit.cancel") || "Annuler"}
      </Button>
      <Button class="btn btn-accent" disabled={saving} on:click={save}>
        {#if saving}
          <i class="fa fa-spinner fa-spin" />
        {:else}
          <i class="fa fa-check" />
        {/if}
        {$_("videoEdit.save") || "Enregistrer"}
      </Button>
    </div>
  </div>
</Modal>
