<script lang="ts">
  import {_, locale} from "svelte-i18n"
  import {onMount} from "svelte"
  import {loginWithNip01} from "@welshman/app"
  import Modal from "src/partials/Modal.svelte"
  import Button from "src/partials/Button.svelte"
  import {nsecDecode} from "src/util/nostr"
  import {
    resolveApiUrl,
    preferredApiUrl,
    preferredRelayUrl,
    preferredIpfsGateway,
  } from "src/util/uplanet-detect"
  import {getCurrentUmap, haversineDistanceKm} from "src/util/geo"
  import {
    fetchConstellationStations,
    enrichStationsWithDiskSpace,
    createOrRestoreMultipass,
    MultipassError,
    type ConstellationStation,
    type MultipassResult,
  } from "src/util/multipass"
  import logger from "src/util/logger"
  import {boot} from "src/app/state"

  export let onClose: () => void

  type Step = "form" | "need-pin" | "success"

  let step: Step = "form"
  let stations: ConstellationStation[] = []
  let hiddenLoopbackCount = 0
  let selectedStation: ConstellationStation | null = null
  let email = ""
  let passCode = ""
  let loading = true
  let locating = false
  let errorMessage = ""
  let result: MultipassResult | null = null
  let savedConfirmed = false

  onMount(async () => {
    try {
      const baseUrl = await resolveApiUrl()
      ;({stations, hiddenLoopbackCount} = await fetchConstellationStations(baseUrl))
      selectedStation = stations[0] || null
    } finally {
      loading = false
    }

    // Disk space for swarm peers isn't in the initial payload — fetch it
    // per-station in the background and re-render once settled.
    enrichStationsWithDiskSpace(stations).then(() => {
      stations = [...stations]
    })
  })

  const stationLabel = (station: ConstellationStation): string => {
    const parts = [station.domain + (station.ipCity ? ` — ${station.ipCity}` : "")]

    if (station.availableSpaceGb !== undefined) {
      parts.push($_("multipass.diskFree", {values: {gb: Math.round(station.availableSpaceGb)}}))
    }

    if (station.paf) {
      parts.push($_("multipass.pafWeekly", {values: {paf: station.paf}}))
    }

    return parts.join(" · ")
  }

  const pickClosestStation = async () => {
    locating = true
    errorMessage = ""

    try {
      const umap = await getCurrentUmap()
      const here = {lat: parseFloat(umap.lat), lon: parseFloat(umap.lon)}

      let closest: ConstellationStation | null = null
      let closestDistance = Infinity

      for (const station of stations) {
        if (!station.lat || !station.lon) continue

        const lat = parseFloat(station.lat)
        const lon = parseFloat(station.lon)
        if (lat === 0 && lon === 0) continue // no GPS configured on that station

        const distance = haversineDistanceKm(here, {lat, lon})
        if (distance < closestDistance) {
          closestDistance = distance
          closest = station
        }
      }

      if (closest) {
        selectedStation = closest
      } else {
        errorMessage = $_("multipass.noStationLocation")
      }
    } catch {
      errorMessage = $_("multipass.geoUnavailable")
    } finally {
      locating = false
    }
  }

  const errorMessageFor = (code: MultipassError["code"]) => {
    const key = `multipass.errors.${code}`
    const translated = $_(key)
    return translated === key ? code : translated
  }

  const submit = async () => {
    if (!selectedStation || !email.trim()) return

    loading = true
    errorMessage = ""

    try {
      let lat: string | undefined
      let lon: string | undefined
      try {
        const umap = await getCurrentUmap()
        lat = umap.lat
        lon = umap.lon
      } catch {
        // geolocation unavailable/denied — send the request without it
      }

      result = await createOrRestoreMultipass(selectedStation.uSPOT, {
        email,
        lang: $locale?.slice(0, 2) || "fr",
        lat,
        lon,
        passCode: passCode || undefined,
      })
      step = "success"
    } catch (err) {
      if (err instanceof MultipassError) {
        errorMessage = errorMessageFor(err.code)
        if (err.code === "MULTIPASS_EXISTS") step = "need-pin"
      } else {
        logger.error("MULTIPASS request failed:", err)
        errorMessage = $_("multipass.errors.UNKNOWN")
      }
    } finally {
      loading = false
    }
  }

  const confirmAndLogin = () => {
    if (!result) return

    const secret = result.nsec.startsWith("nsec1") ? nsecDecode(result.nsec) : result.nsec

    // Pin the new identity to the exact station it was created on — its own
    // uSPOT/myRELAY/myIPFS, used as-is (never re-derived from a hostname).
    if (selectedStation) {
      preferredApiUrl.set(selectedStation.uSPOT)
      if (selectedStation.myRELAY) preferredRelayUrl.set(selectedStation.myRELAY)
      if (selectedStation.myIPFS) preferredIpfsGateway.set(selectedStation.myIPFS)
    }

    loginWithNip01(secret)
    boot()
    onClose()
  }
</script>

<Modal onEscape={onClose} canClose={!loading}>
  <div class="flex flex-col gap-4 p-2">
    {#if step === "success" && result}
      <h2 class="staatliches text-xl">{$_("multipass.successTitle")}</h2>
      <p class="rounded border border-accent p-3 text-sm text-tinted-200">
        {$_("multipass.saveWarning")}
      </p>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400">{$_("multipass.pass")}</label>
        <code
          class="select-all rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          >{result.pass}</code>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400">{$_("multipass.ssss")}</label>
        <code
          class="select-all break-all rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          >{result.ssss}</code>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={savedConfirmed} />
        {$_("multipass.confirmSaved")}
      </label>
      <div class="flex justify-end">
        <Button class="btn btn-accent" disabled={!savedConfirmed} on:click={confirmAndLogin}>
          <i class="fa fa-check" />
          {$_("multipass.continue")}
        </Button>
      </div>
    {:else}
      <h2 class="staatliches text-xl">{$_("multipass.title")}</h2>
      <p class="text-xs text-neutral-500">{$_("multipass.hint")}</p>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <label class="text-xs font-medium text-neutral-400">{$_("multipass.station")}</label>
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-50"
            disabled={loading || locating || stations.length === 0}
            on:click={pickClosestStation}>
            {#if locating}
              <i class="fa fa-spinner fa-spin" />
            {:else}
              <i class="fa fa-location-crosshairs" />
            {/if}
            {$_("multipass.findClosest")}
          </button>
        </div>
        <select
          bind:value={selectedStation}
          disabled={loading || stations.length === 0}
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent">
          {#each stations as station}
            <option value={station}>
              {stationLabel(station)}
            </option>
          {/each}
        </select>
        {#if hiddenLoopbackCount > 0}
          <p class="text-xs text-neutral-500">
            {$_("multipass.hiddenLocalStations", {values: {count: hiddenLoopbackCount}})}
          </p>
        {/if}
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400">{$_("multipass.email")}</label>
        <input
          bind:value={email}
          disabled={loading}
          type="email"
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent" />
      </div>

      {#if step === "need-pin"}
        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-neutral-400">{$_("multipass.pin")}</label>
          <input
            bind:value={passCode}
            disabled={loading}
            type="password"
            inputmode="numeric"
            class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-accent" />
        </div>
      {/if}

      {#if errorMessage}
        <p class="text-sm text-danger">{errorMessage}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button class="btn" disabled={loading} on:click={onClose}>
          {$_("multipass.cancel")}
        </Button>
        <Button
          class="btn btn-accent"
          disabled={loading || !selectedStation || !email.trim()}
          on:click={submit}>
          {#if loading}
            <i class="fa fa-spinner fa-spin" />
          {:else}
            <i class="fa fa-key" />
          {/if}
          {$_("multipass.submit")}
        </Button>
      </div>
    {/if}
  </div>
</Modal>
