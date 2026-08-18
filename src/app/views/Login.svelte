<script lang="ts">
  import {_} from "svelte-i18n"
  import {onMount} from "svelte"
  import {Capacitor} from "@capacitor/core"
  import {getNip07, Nip07Signer, getNip55, Nip55Signer} from "@welshman/signer"
  import {loginWithNip55, loginWithNip07} from "@welshman/app"
  import {appName} from "src/partials/state"
  import Link from "src/partials/Link.svelte"
  import Button from "src/partials/Button.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Heading from "src/partials/Heading.svelte"
  import MultipassLogin from "src/app/shared/MultipassLogin.svelte"
  import {boot} from "src/app/state"

  // Define the interface for AppInfo
  interface AppInfo {
    name: string
    packageName: string
    iconUrl?: string
  }

  const useExtension = async () => {
    const signer = new Nip07Signer()
    const pubkey = await signer.getPubkey()
    loginWithNip07(pubkey)
    boot()
  }

  const useSigner = async (app: AppInfo) => {
    const signer = new Nip55Signer(app.packageName)
    const pubkey = await signer.getPubkey()
    loginWithNip55(pubkey, app.packageName)
    boot()
  }

  let signerApps: AppInfo[] = []
  let showMultipassLogin = false

  onMount(async () => {
    if (Capacitor.isNativePlatform()) {
      signerApps = await getNip55()
    }
  })

  document.title = $_("login.title")
</script>

<div>
  <FlexColumn narrow large>
    <div class="text-center">
      <Heading>{$_("login.welcome")}</Heading>
      <p>
        {$_("login.builtWith", {values: {appName}})}
        <Link class="underline" external href="https://nostr.com/">{$_("login.nostrProtocol")}</Link
        >{$_("login.ownsIdentity")}
      </p>
    </div>
    <div class="relative flex flex-col gap-4">
      {#if getNip07()}
        <!-- Extension NIP-07 (nos2x, Alby…) — méthode recommandée -->
        <Button class="btn btn-tall btn-accent" on:click={useExtension}>
          <i class="fa fa-puzzle-piece" />
          {$_("login.useExtension")}
        </Button>
      {:else}
        <!-- Aucune extension détectée: guider l'utilisateur -->
        <div class="rounded border border-tinted-600 p-4 text-center text-sm text-tinted-400">
          <i class="fa fa-puzzle-piece mb-2 text-2xl text-accent" />
          <p class="mb-2">{$_("login.noExtension")}</p>
          <Button class="btn btn-accent btn-sm" on:click={() => (showMultipassLogin = true)}>
            <i class="fa fa-key" />
            {$_("login.createAccount")}
          </Button>
        </div>
      {/if}
      <!-- NIP-55 signers (Android mobile apps) -->
      {#each signerApps as app}
        <Button class="btn btn-tall" on:click={() => useSigner(app)}>
          <img src={app.iconUrl} alt={app.name} width="20" height="20" />
          {$_("login.use", {values: {name: app.name}})}
        </Button>
      {/each}
    </div>
    <!-- Signup / restore → MULTIPASS (UPassport /g1nostr) -->
    <span class="text-center text-sm">
      {$_("login.needAccount")}
      <button class="underline" on:click={() => (showMultipassLogin = true)}>
        {$_("login.registerInstead")}
      </button>
    </span>
  </FlexColumn>
</div>

{#if showMultipassLogin}
  <MultipassLogin onClose={() => (showMultipassLogin = false)} />
{/if}
