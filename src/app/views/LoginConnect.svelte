<script lang="ts">
  import {_} from "svelte-i18n"
  import {onMount} from "svelte"
  import {sleep, spec} from "@welshman/lib"
  import {
    RELAYS,
    FOLLOWS,
    PROFILE,
    getRelayTagValues,
    normalizeRelayUrl,
    isRelayUrl,
  } from "@welshman/util"
  import {deriveEvents} from "@welshman/store"
  import {session, repository} from "@welshman/app"
  import {showWarning} from "src/partials/Toast.svelte"
  import Modal from "src/partials/Modal.svelte"
  import Field from "src/partials/Field.svelte"
  import Input from "src/partials/Input.svelte"
  import Content from "src/partials/Content.svelte"
  import Spinner from "src/partials/Spinner.svelte"
  import Subheading from "src/partials/Subheading.svelte"
  import Button from "src/partials/Button.svelte"
  import {router} from "src/app/util/router"
  import {detectUPlanetServices} from "src/util/uplanet-detect"
  import {env, myLoad} from "src/engine"
  import {loadUserData} from "src/app/state"

  const uplanet = detectUPlanetServices()

  const t = Date.now()

  const kinds = [PROFILE, RELAYS, FOLLOWS]
  const filters = [{kinds, authors: [$session.pubkey]}]
  const events = deriveEvents({repository, filters})

  const skip = () => router.at("notes").push()

  const searchRelays = relays => myLoad({filters, relays})

  const confirmCustomRelay = () => {
    const url = normalizeRelayUrl(customRelay)

    if (isRelayUrl(url)) {
      searchRelays([url])
      customRelay = ""
      closeModal()
    } else {
      showWarning($_("login.invalidRelayUrl"))
    }
  }

  const tryDefaultRelays = () => {
    searchRelays([...env.DEFAULT_RELAYS, ...env.INDEXER_RELAYS])
  }

  const openModal = m => {
    modal = m
  }

  const closeModal = () => {
    modal = null
  }

  /**
   * Proceed to the app: load user data then navigate to the notes feed.
   * Called either when all events are found, or when UPlanet auto-proceeds
   * after a short timeout (profile might exist on the relay but kind 10002
   * relay list is not required for UPlanet — the relay is derived from the URL).
   */
  const proceed = () => {
    if (found) return
    found = true
    loadUserData()
    sleep(Math.max(0, 2500 - (Date.now() - t))).then(async () => {
      showFound = true
      await sleep(2000)
      router.at("notes").push()
    })
  }

  let found, showFound, failed, modal
  let customRelay = ""

  // Search the UPlanet relay (already injected first in env.DEFAULT_RELAYS
  // by engine/state.ts when detectUPlanetServices() returns a result)
  tryDefaultRelays()

  // React to relay selection event
  $: {
    const relaySelectionsEvent = $events.find(spec({kind: RELAYS}))
    if (!found && relaySelectionsEvent) {
      searchRelays(getRelayTagValues(relaySelectionsEvent.tags))
    }
  }

  // UPlanet: finding the profile (kind 0) is enough — kind 10002 may not
  // be published by older make_NOSTRCARD.sh versions.
  // Standard: require all 3 events (kind 0 + 3 + 10002).
  $: {
    const profileFound = $events.some(e => e.kind === PROFILE)
    const allFound = $events.length === 3

    if (!found && (allFound || (uplanet && profileFound))) {
      proceed()
    }
  }

  onMount(() => {
    if (uplanet) {
      // UPlanet: relay is known from URL — auto-proceed if profile not found
      // quickly (new account or relay temporarily slow)
      sleep(4000).then(() => {
        if (!found) {
          proceed()
        }
      })
    } else {
      // Standard Nostr: show failure UI after 8s
      sleep(8000).then(() => {
        if (!found) failed = true
      })
    }
  })
</script>

<Content size="lg">
  {#if showFound}
    <p class="text-center text-2xl">{$_("login.connectSuccess")}</p>
  {:else if uplanet}
    <!-- UPlanet: simplified UI — relay is known, no confusing options -->
    <p class="text-2xl">{$_("login.connectSearching")}</p>
    <p class="flex items-center gap-2 text-sm text-tinted-400">
      <i class="fa fa-circle-nodes text-accent" />
      {$_("login.uplanetDetected", {values: {relay: uplanet.relayUrl}})}
    </p>
  {:else if failed && !found}
    <!-- Standard Nostr: relay selection fallback UI -->
    <p class="text-2xl">{$_("login.connectFailed")}</p>
    <p>
      {$_("login.youCanAlso")}
      <Button class="text-inherit cursor-pointer bg-transparent p-0 underline" on:click={skip}
        >{$_("login.skipThisStep")}</Button
      >{$_("login.skipWarning")}
    </p>
    <div class="flex justify-between gap-2">
      <Button class="btn" on:click={tryDefaultRelays}>{$_("login.tryAgain")}</Button>
      <Button class="btn btn-accent" on:click={() => openModal("custom_relay")}
        >{$_("login.selectRelaysManually")}</Button>
    </div>
  {:else}
    <p class="text-2xl">{$_("login.connectSearching")}</p>
    <p>
      {$_("login.selectRelaysHint")}
      <Button
        class="text-inherit cursor-pointer bg-transparent p-0 underline"
        on:click={() => openModal("custom_relay")}>{$_("common.here")}</Button
      >.
    </p>
    <p>
      {$_("login.youCanAlso")}
      <Button class="text-inherit cursor-pointer bg-transparent p-0 underline" on:click={skip}
        >{$_("login.skipThisStep")}</Button
      >{$_("login.skipWarning")}
    </p>
  {/if}
  <Spinner />
</Content>

{#if !showFound && !uplanet && modal === "custom_relay"}
  <Modal>
    <Content size="lg">
      <Subheading>{$_("login.customRelay")}</Subheading>
      <p>{$_("login.customRelayDescription")}</p>
      <Field label={$_("login.relay")}>
        <Input bind:value={customRelay} />
      </Field>
      <div class="flex justify-between gap-2">
        <Button class="btn" on:click={closeModal}>{$_("common.cancel")}</Button>
        <Button class="btn btn-accent" on:click={confirmCustomRelay}
          >{$_("login.searchRelay")}</Button>
      </div>
    </Content>
  </Modal>
{/if}
