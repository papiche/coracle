<script lang="ts">
  import {session, displayProfileByPubkey, tagReplyTo, tagPubkey} from "@welshman/app"
  import {ctx} from "@welshman/lib"
  import {Tags, createEvent, uniqTags} from "@welshman/util"
  import {writable, type Writable} from "svelte/store"
  import {createEventDispatcher} from "svelte"
  import {Editor} from "svelte-tiptap"
  import {without, uniq} from "ramda"
  import {slide} from "src/util/transition"
  import AltColor from "src/partials/AltColor.svelte"
  import Chip from "src/partials/Chip.svelte"
  import {getEditorOptions} from "src/app/editor"
  import Compose from "src/app/shared/Compose.svelte"
  import NsecWarning from "src/app/shared/NsecWarning.svelte"
  import NoteOptions from "src/app/shared/NoteOptions.svelte"
  import {drafts} from "src/app/state"
  import {publish, tagsFromContent, getClientTags, sign, userSettings} from "src/engine"

  export let parent
  export let addDraftToContext
  export let showBorder = false
  export let forceOpen = false

  const dispatch = createEventDispatcher()
  const nsecWarning = writable(null)
  const parentTags = Tags.fromEvent(parent)

  let container, loading
  let isOpen = false
  let showOptions = false
  let mentions = []
  let options = {warning: "", anonymous: false}
  let editorElement: HTMLElement
  let editor: Editor
  let editorLoading: Writable<boolean>

  export const start = () => {
    dispatch("start")

    isOpen = true
    mentions = without(
      [$session.pubkey],
      uniq(parentTags.values("p").valueOf().concat(parent.pubkey)),
    )
  }

  const bypassNsecWarning = () => {
    nsecWarning.set(null)
    send({skipNsecWarning: true})
  }

  const openOptions = () => {
    showOptions = true
  }

  const closeOptions = () => {
    showOptions = false
  }

  const setOptions = values => {
    options = {...options, ...values}
    showOptions = false
  }

  const saveDraft = () => {
    if (editor) {
      drafts.set(parent.id, editor.getHTML())
    }
  }

  const clearDraft = () => {
    drafts.delete(parent.id)
  }

  const reset = () => {
    dispatch("reset")

    isOpen = false
    mentions = []
  }

  const removeMention = pubkey => {
    mentions = without([pubkey], mentions)
  }

  const send = async ({skipNsecWarning = false} = {}) => {
    if ($editorLoading) return

    const content = editor.getText({blockSeparator: "\n"}).trim()

    if (!content) return

    if (!skipNsecWarning && content.match(/\bnsec1.+/)) return nsecWarning.set(true)

    const tags = uniqTags([
      ...mentions.map(tagPubkey),
      ...tagReplyTo(parent),
      ...tagsFromContent(content),
      ...editor.commands.getMetaTags(),
      ...getClientTags(),
    ])

    if (options.warning) {
      tags.push(["content-warning", options.warning])
    }

    // Re-broadcast the note we're replying to
    if (!parent.wrap) {
      publish({event: parent, relays: ctx.app.router.PublishEvent(parent).getUrls()})
    }

    loading = true

    const template = createEvent(1, {content, tags})
    const event = await sign(template, options)
    const thunk = publish({
      event,
      relays: ctx.app.router.PublishEvent(event).getUrls(),
      delay: $userSettings.send_delay,
    })

    addDraftToContext(event, () => thunk.controller.abort())
    isOpen = false
    loading = false

    thunk.result.then(() => {
      clearDraft()
      reset()
    })
  }

  const onBodyClick = e => {
    const target = e.target as HTMLElement

    if (isOpen && container && !container.contains(target)) {
      saveDraft()
      reset()
    }
  }

  const createEditor = () => {
    editor = new Editor(
      getEditorOptions({
        submit: send,
        element: editorElement,
        submitOnEnter: false,
        submitOnModEnter: true,
        autofocus: true,
        content: drafts.get(parent.id) || "",
      }),
    )

    editorLoading = editor.storage.fileUpload.loading
  }

  $: {
    if (editorElement) {
      createEditor()
    }
  }
</script>

<svelte:body on:click={onBodyClick} />

{#if isOpen || forceOpen}
  <div
    class="relative transition-colors"
    class:opacity-50={loading}
    class:pointer-events-none={loading}>
    {#if showBorder}
      <AltColor background class="absolute -top-4 z-none h-5 w-1" />
    {/if}
    <div
      transition:slide|local
      class="note-reply relative my-2 gap-1"
      bind:this={container}
      on:click|stopPropagation>
      <AltColor background class="overflow-hidden rounded">
        <div class="p-3 text-neutral-100" class:rounded-b={mentions.length === 0}>
          <Compose bind:element={editorElement} {editor}>
            <div class="flex flex-col justify-start" slot="addon">
              <button
                disabled={$editorLoading}
                class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full transition-all"
                class:hover:bg-accent={!$editorLoading}
                on:click={() => send()}>
                {#if loading || $editorLoading}
                  <i class="fa fa-circle-notch fa-spin" />
                {:else}
                  <i class="fa fa-paper-plane" />
                {/if}
              </button>
            </div>
          </Compose>
        </div>
        <div class="h-px" />
        <div class="flex gap-2 rounded-b p-2 text-sm text-neutral-100">
          <div class="flex border-r border-solid border-neutral-600 py-2 pl-1 pr-3">
            <div class="flex cursor-pointer items-center gap-3">
              <i class="fa fa-paperclip" on:click|preventDefault={editor.commands.selectFiles} />
              <i class="fa fa-cog" on:click|preventDefault={openOptions} />
            </div>
          </div>
          <div on:click|stopPropagation class="flex items-center">
            {#each mentions as pubkey}
              <Chip class="mb-1 mr-1" onRemove={() => removeMention(pubkey)}>
                {displayProfileByPubkey(pubkey)}
              </Chip>
            {:else}
              <div class="text-neutral-100 inline-block py-2">No mentions</div>
            {/each}
            <div class="-mb-2" />
          </div>
        </div>
      </AltColor>
    </div>
  </div>
{/if}

{#if showOptions}
  <NoteOptions onClose={closeOptions} onSubmit={setOptions} initialValues={options} />
{/if}

{#if $nsecWarning}
  <NsecWarning onAbort={() => nsecWarning.set(null)} onBypass={bypassNsecWarning} />
{/if}
