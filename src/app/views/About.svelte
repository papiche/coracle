<script lang="ts">
  import {onMount} from "svelte"
  import {_} from "svelte-i18n"
  import {Capacitor} from "@capacitor/core"
  import Popover from "src/partials/Popover.svelte"
  import Link from "src/partials/Link.svelte"
  import Button from "src/partials/Button.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import Heading from "src/partials/Heading.svelte"
  import {router} from "src/app/util"
  import {loadPubkeys, env} from "src/engine"
  import {resolveApiUrl} from "src/util/uplanet-detect"

  const hash = import.meta.env.VITE_BUILD_HASH
  const openFeedbackForm = () => router.at("feedback/create").open()

  // Falls back to the build's configured platform pubkey if this station
  // isn't UPlanet, or /api/nostr/admin/captain_info is unreachable.
  let builtByPubkey = env.PLATFORM_PUBKEY

  // build-web-compatible-ipfs.sh bundles www/ (landing + comparison page,
  // download link for the APK inside it) into dist/www/ — same CID as the
  // rest of the app, so a plain relative link always resolves, with no
  // separate publish/DNS step to keep in sync. Hidden in the native app
  // itself, which obviously doesn't need to download itself.
  const apkPageUrl = "./www/"
  const isNative = Capacitor.isNativePlatform()

  onMount(async () => {
    try {
      const apiUrl = await resolveApiUrl()
      const res = await fetch(`${apiUrl}/api/nostr/admin/captain_info`)

      if (res.ok) {
        const data = await res.json()
        if (data.captain_hex) {
          builtByPubkey = data.captain_hex
        }
      }
    } catch (err) {
      // not on an UPlanet station, or the API is unreachable — keep the fallback
    }

    loadPubkeys([builtByPubkey])
  })

  document.title = $_("about.title")
</script>

<FlexColumn class="gap-8">
  <div class="flex flex-col items-center justify-center">
    <Heading>Coracle</Heading>
    <h2 class="m-auto text-center">{$_("about.subtitle")}</h2>
    {#if hash}
      <p class="mt-1 text-xs">{$_("about.runningBuild", {values: {hash: hash.slice(0, 8)}})}</p>
    {/if}
  </div>
  <div class="grid grid-cols-1 gap-8 sm:grid-cols-2">
    <Card>
      <FlexColumn class="py-6 text-center">
        <h3 class="text-xl sm:h-12">{$_("about.supportDev")}</h3>
        <p class="sm:h-20">{$_("about.supportDevDescription")}</p>
        <div class="flex justify-center">
          <Link
            class="btn btn-accent"
            external
            href="https://opencollective.com/monnaie-libre/contribute">
            {$_("about.joinOpenCollective")}
          </Link>
        </div>
      </FlexColumn>
    </Card>
    <Card>
      <FlexColumn class="py-6 text-center">
        <h3 class="text-xl sm:h-12">{$_("about.getInTouch")}</h3>
        <p class="sm:h-20">{$_("about.getInTouchDescription")}</p>
        <div class="flex justify-center">
          <Button class="btn btn-accent" on:click={openFeedbackForm}>
            {$_("about.openIssue")}
          </Button>
        </div>
      </FlexColumn>
    </Card>
  </div>
  {#if !isNative}
    <Card>
      <FlexColumn class="items-center py-6 text-center">
        <i class="fa fa-mobile-screen-button text-4xl text-accent" />
        <h3 class="text-xl">{$_("about.installMobile")}</h3>
        <p>{$_("about.installMobileDescription")}</p>
        <div class="flex justify-center">
          <Link class="btn btn-accent" external href={apkPageUrl}>
            <i class="fa fa-android" />
            {$_("about.installMobileCta")}
          </Link>
        </div>
      </FlexColumn>
    </Card>
  {/if}
  <div class="flex flex-col gap-4">
    <p class="text-center">
      {$_("about.builtBy")}<Link
        modal
        class="underline"
        href={router.at("people").of(builtByPubkey).toString()}>{$_("about.g1fablab")}</Link>
    </p>
    <p class="flex justify-center gap-4">
      <Popover triggerType="mouseenter">
        <div slot="trigger">
          <Link external href="https://github.com/papiche/coracle"
            ><i class="fa fa-code-branch" /></Link>
        </div>
        <div slot="tooltip">{$_("about.sourceCode")}</div>
      </Popover>
      <Popover triggerType="mouseenter">
        <div slot="trigger">
          <Link external href="https://opencollective.com/monnaie-libre">
            <i class="fa fa-earth-americas" />
          </Link>
        </div>
        <div slot="tooltip">{$_("about.website")}</div>
      </Popover>
    </p>
  </div>
</FlexColumn>
