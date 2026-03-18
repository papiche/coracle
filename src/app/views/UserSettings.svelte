<script lang="ts">
  import {_} from "svelte-i18n"
  import {identity, equals} from "@welshman/lib"
  import {BLOSSOM_SERVERS, tagger, getListTags, getTagValues, makeEvent} from "@welshman/util"
  import {Router} from "@welshman/router"
  import {userBlossomServerList, publishThunk} from "@welshman/app"
  import {ensureProto} from "src/util/misc"
  import {appName, locale} from "src/partials/state"
  import {showInfo} from "src/partials/Toast.svelte"
  import Field from "src/partials/Field.svelte"
  import Footer from "src/partials/Footer.svelte"
  import FieldInline from "src/partials/FieldInline.svelte"
  import Toggle from "src/partials/Toggle.svelte"
  import Input from "src/partials/Input.svelte"
  import Button from "src/partials/Button.svelte"
  import Heading from "src/partials/Heading.svelte"
  import {fuzzy} from "src/util/misc"
  import SearchSelect from "src/partials/SearchSelect.svelte"
  import {env, userSettings, publishSettings} from "src/engine"
  import {detectUPlanetServices} from "src/util/uplanet-detect"

  const uplanet = detectUPlanetServices()
  const uplanetBlossomUrl = uplanet?.apiUrl || "https://u.copylaradio.com"

  const initialBlossomServers = getTagValues("server", getListTags($userBlossomServerList))

  const submit = () => {
    if (!equals($userSettings, values)) {
      publishSettings(values)
    }

    if (!equals(blossomServers, initialBlossomServers)) {
      const tags = blossomServers.map(ensureProto).map(tagger("server"))

      publishThunk({
        event: makeEvent(BLOSSOM_SERVERS, {tags}),
        relays: Router.get().FromUser().getUrls(),
      })
    }

    showInfo($_("settings.saved"))
  }

  const searchBlossomProviders = fuzzy(env.BLOSSOM_URLS, {keys: ["url"]})

  const values = {...$userSettings}

  let blossomServers = Array.from(initialBlossomServers)

  document.title = $_("settings.title")
</script>

<form on:submit|preventDefault={submit}>
  <div class="mb-4 flex flex-col items-center justify-center">
    <Heading>{$_("settings.appSettings")}</Heading>
    <p>{$_("settings.makeAppWork", {values: {appName}})}</p>
  </div>
  <div class="flex w-full flex-col gap-8">
    <Field label={$_("settings.language")}>
      <select
        class="rounded border border-solid border-tinted-700 bg-tinted-700 px-4 py-2 text-tinted-200"
        bind:value={$locale}>
        <option value="en">English</option>
        <option value="fr">Français</option>
        <option value="es">Español</option>
      </select>
      <p slot="info">{$_("settings.languageInfo")}</p>
    </Field>
    <Field>
      <div slot="label" class="flex justify-between">
        <strong>{$_("settings.maxRelays")}</strong>
        <div>{values.relay_limit} {$_("common.relays")}</div>
      </div>
      <Input type="range" bind:value={values.relay_limit} min={1} max={10} parse={parseInt} />
      <p slot="info">
        {$_("settings.maxRelaysInfo")}
      </p>
    </Field>
    <FieldInline label={$_("settings.authenticateRelays")}>
      <Toggle bind:value={values.auto_authenticate2} />
      <p slot="info">
        {$_("settings.authenticateRelaysInfo", {values: {appName}})}
      </p>
    </FieldInline>
    <Field label={$_("settings.blossomUrls")}>
      <div slot="info" class="flex flex-col gap-1">
        <p>{$_("settings.blossomInfo")}</p>
        <p class="flex items-center gap-2 text-xs">
          <i class="fa fa-circle-nodes text-accent" />
          <span class="text-tinted-400">{$_("settings.blossomUplanet")}</span>
          <code class="rounded bg-tinted-700 px-1 text-accent">{uplanetBlossomUrl}</code>
        </p>
      </div>
      <SearchSelect
        multiple
        search={searchBlossomProviders}
        bind:value={blossomServers}
        termToItem={identity}>
        <div slot="item" let:item>
          <strong>{item}</strong>
        </div>
      </SearchSelect>
    </Field>
    <FieldInline label={$_("settings.clientFingerprinting")}>
      <Toggle bind:value={values.enable_client_tag} />
      <p slot="info">
        {$_("settings.clientFingerprintingInfo", {values: {appName}})}
      </p>
    </FieldInline>
  </div>
  <Footer>
    <Button class="btn flex-grow" type="submit">{$_("common.save")}</Button>
  </Footer>
</form>
