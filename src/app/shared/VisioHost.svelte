<script lang="ts">
  import {onDestroy} from "svelte"
  import Button from "src/partials/Button.svelte"
  import PersonName from "src/app/shared/PersonName.svelte"
  import {router} from "src/app/util/router"
  import {activeVisio, closeVisio, incomingInvite, openVisio} from "src/engine"
  import {buildVisioUrl} from "src/util/visio"

  const page = router.page

  let timer: ReturnType<typeof setTimeout> | undefined

  // L'invitation disparaît toute seule à son échéance (2 min au plus) : une sonnerie n'attend pas.
  $: {
    clearTimeout(timer)

    if ($incomingInvite) {
      const ms = ($incomingInvite.invite.expires_at - Math.floor(Date.now() / 1000)) * 1000

      timer = setTimeout(dismiss, Math.max(5_000, Math.min(120_000, ms)))
    }
  }

  // La carte est déjà dans le fil de cette conversation : pas de doublon flottant.
  $: inThatChannel = Boolean($incomingInvite && $page?.path?.includes($incomingInvite.from))

  const dismiss = () => incomingInvite.set(null)

  const join = () => {
    if (!$incomingInvite) return

    openVisio($incomingInvite.invite)
    dismiss()
  }

  const popOut = () => {
    if (!$activeVisio) return

    window.open(
      buildVisioUrl($activeVisio.room, {label: $activeVisio.label}),
      "_blank",
      "noopener,noreferrer",
    )
    closeVisio()
  }

  onDestroy(() => clearTimeout(timer))
</script>

{#if $incomingInvite && !inThatChannel && !$activeVisio}
  <div
    role="alert"
    aria-live="polite"
    class="fixed right-3 top-16 z-popover flex max-w-xs flex-col gap-2 rounded-xl border border-accent bg-tinted-800 p-3 shadow-xl">
    <div class="flex items-center gap-2">
      <i class="fa fa-video" />
      <span><PersonName pubkey={$incomingInvite.from} /> invites you to a video call</span>
    </div>
    <div class="flex gap-2">
      <Button class="btn btn-accent flex-grow" on:click={join}>Join</Button>
      <Button class="btn btn-low" on:click={dismiss}>Ignore</Button>
    </div>
  </div>
{/if}

<!-- L'iframe n'est créée qu'ici, à l'ouverture d'une salle : rien n'est chargé avant. -->
{#if $activeVisio}
  <div
    role="dialog"
    aria-label="Video call"
    class="fixed bottom-3 right-3 z-popover flex h-[70vh] max-h-[560px] w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl bg-black shadow-2xl">
    <div class="flex items-center gap-2 bg-tinted-800 px-3 py-2">
      <strong class="flex-grow">Video call</strong>
      <Button class="btn btn-low" title="Open in a window" on:click={popOut}>
        <i class="fa fa-up-right-from-square" />
      </Button>
      <Button class="btn btn-low" title="Leave" on:click={closeVisio}>
        <i class="fa fa-phone-slash" />
      </Button>
    </div>
    <iframe
      title="Video call"
      class="w-full flex-grow border-0"
      allow="camera; microphone; display-capture; autoplay; fullscreen"
      src={buildVisioUrl($activeVisio.room, {label: $activeVisio.label})} />
  </div>
{/if}
