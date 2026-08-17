<script lang="ts">
  import {_} from "svelte-i18n"
  import Modal from "src/partials/Modal.svelte"
  import Button from "src/partials/Button.svelte"
  import PersonSelect from "src/app/shared/PersonSelect.svelte"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import logger from "src/util/logger"
  import {getBestAudioMimeType, uploadVocalAudio, publishVocalMessage} from "src/util/vocals"

  export let replyTo: {id: string; pubkey: string; relay?: string} | undefined = undefined
  export let onClose: () => void
  export let onPublished: () => void = () => {}

  type Stage = "idle" | "recording" | "recorded" | "publishing"

  let stage: Stage = "idle"
  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let audioBlob: Blob | null = null
  let audioUrl = ""
  let duration = 0
  let elapsed = 0
  let timer: ReturnType<typeof setInterval> | null = null

  let title = ""
  let description = ""
  let isPrivate = false
  let recipients: string[] = []

  let geoEnabled = false
  let latitude = ""
  let longitude = ""
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
        showWarning($_("vocaux.locationFailed") || "Impossible d'obtenir la position")
      },
    )
  }

  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
      })
      const mimeType = getBestAudioMimeType()
      mediaRecorder = new MediaRecorder(stream, {mimeType})
      chunks = []
      elapsed = 0

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      mediaRecorder.onstop = () => {
        audioBlob = new Blob(chunks, {type: mimeType})
        audioUrl = URL.createObjectURL(audioBlob)
        duration = elapsed
        stream.getTracks().forEach(t => t.stop())
        stage = "recorded"
      }

      mediaRecorder.start()
      stage = "recording"
      timer = setInterval(() => {
        elapsed += 1
        // Safety cap matching UPassport's own recorder limit.
        if (elapsed >= 120) stopRecording()
      }, 1000)
    } catch (err) {
      logger.error("Microphone access failed:", err)
      showWarning($_("vocaux.micDenied") || "Accès au microphone refusé")
    }
  }

  const stopRecording = () => {
    stopTimer()
    mediaRecorder?.stop()
  }

  const discardRecording = () => {
    audioBlob = null
    audioUrl = ""
    duration = 0
    elapsed = 0
    stage = "idle"
  }

  const publish = async () => {
    if (!audioBlob) return
    if (!title.trim()) {
      showWarning($_("vocaux.titleRequired") || "Un titre est requis")
      return
    }
    if (isPrivate && recipients.length === 0) {
      showWarning($_("vocaux.recipientRequired") || "Choisissez un destinataire")
      return
    }

    stage = "publishing"
    try {
      const uploaded = await uploadVocalAudio(audioBlob)
      await publishVocalMessage({
        uploaded,
        title: title.trim(),
        description: description.trim() || undefined,
        duration,
        latitude: geoEnabled && latitude ? parseFloat(latitude).toFixed(2) : undefined,
        longitude: geoEnabled && longitude ? parseFloat(longitude).toFixed(2) : undefined,
        recipientPubkey: isPrivate ? recipients[0] : undefined,
        replyTo,
      })
      showInfo($_("vocaux.published") || "Message vocal publié !")
      onPublished()
      onClose()
    } catch (err) {
      logger.error("Failed to publish vocal message:", err)
      showWarning(
        (err as Error)?.message || $_("vocaux.publishFailed") || "Échec de la publication",
      )
      stage = "recorded"
    }
  }

  const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
</script>

<Modal onEscape={onClose}>
  <div class="flex flex-col gap-4 p-2">
    <h2 class="staatliches text-xl">
      {replyTo
        ? $_("vocaux.newReply") || "Répondre en vocal"
        : $_("vocaux.newMessage") || "Nouveau message vocal"}
    </h2>

    <div
      class="flex flex-col items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-6">
      {#if stage === "idle"}
        <button
          type="button"
          class="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl text-white transition-transform hover:scale-105"
          on:click={startRecording}>
          <i class="fa fa-microphone" />
        </button>
        <p class="text-sm text-neutral-400">
          {$_("vocaux.tapToRecord") || "Appuyez pour enregistrer"}
        </p>
      {:else if stage === "recording"}
        <button
          type="button"
          class="bg-red-600 flex h-16 w-16 items-center justify-center rounded-full text-2xl text-white"
          on:click={stopRecording}>
          <i class="fa fa-stop" />
        </button>
        <p class="text-red-400 animate-pulse text-sm">
          <i class="fa fa-circle" />
          {formatElapsed(elapsed)}
        </p>
      {:else if stage === "recorded" || stage === "publishing"}
        <audio controls src={audioUrl} class="w-full" />
        <div class="flex items-center gap-2">
          <span class="text-xs text-neutral-500">{formatElapsed(duration)}</span>
          <button
            type="button"
            class="text-xs text-neutral-400 underline hover:text-neutral-200"
            disabled={stage === "publishing"}
            on:click={discardRecording}>
            <i class="fa fa-rotate-left" />
            {$_("vocaux.rerecord") || "Recommencer"}
          </button>
        </div>
      {/if}
    </div>

    {#if stage === "recorded" || stage === "publishing"}
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-neutral-400"
            >{$_("vocaux.messageTitle") || "Titre"} *</label>
          <input
            bind:value={title}
            disabled={stage === "publishing"}
            class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
            placeholder={$_("vocaux.titlePlaceholder") || "Un mot pour ce message…"}
            type="text" />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-neutral-400"
            >{$_("vocaux.description") || "Description (optionnel)"}</label>
          <input
            bind:value={description}
            disabled={stage === "publishing"}
            class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
            type="text" />
        </div>

        <label class="flex items-center gap-2 text-xs font-medium text-neutral-400">
          <input type="checkbox" bind:checked={isPrivate} disabled={stage === "publishing"} />
          <i class="fa fa-lock" />
          {$_("vocaux.private") || "Message privé (chiffré)"}
        </label>
        {#if isPrivate}
          <PersonSelect bind:value={recipients} multiple={false} />
        {/if}

        <label class="flex items-center gap-2 text-xs font-medium text-neutral-400">
          <input type="checkbox" bind:checked={geoEnabled} disabled={stage === "publishing"} />
          <i class="fa fa-map-marker-alt" />
          {$_("vocaux.geolocate") || "Ajouter la position (UMAP)"}
        </label>
        {#if geoEnabled}
          <div class="flex flex-wrap items-center gap-2">
            <input
              bind:value={latitude}
              disabled={stage === "publishing"}
              class="w-28 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
              placeholder={$_("blog.latitude") || "Latitude"}
              type="number"
              step="0.01" />
            <input
              bind:value={longitude}
              disabled={stage === "publishing"}
              class="w-28 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent"
              placeholder={$_("blog.longitude") || "Longitude"}
              type="number"
              step="0.01" />
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-300 disabled:opacity-50"
              disabled={locating || stage === "publishing"}
              on:click={useMyLocation}>
              {#if locating}
                <i class="fa fa-spinner fa-spin" />
              {:else}
                <i class="fa fa-location-crosshairs" />
              {/if}
              {$_("blog.useMyLocation") || "Ma position"}
            </button>
          </div>
        {/if}

        <Button class="btn btn-accent" disabled={stage === "publishing"} on:click={publish}>
          {#if stage === "publishing"}
            <i class="fa fa-spinner fa-spin" />
            {$_("vocaux.publishing") || "Publication…"}
          {:else}
            <i class="fa fa-paper-plane" />
            {$_("vocaux.publish") || "Publier"}
          {/if}
        </Button>
      </div>
    {/if}
  </div>
</Modal>
