<script lang="ts">
  import {_} from "svelte-i18n"
  import {nwc} from "@getalby/sdk"
  import {LOCALE} from "@welshman/lib"
  import {displayRelayUrl, fromMsats} from "@welshman/util"
  import {session, pubkey, deriveProfile} from "@welshman/app"
  import Icon from "src/partials/Icon.svelte"
  import Link from "src/partials/Link.svelte"
  import {getWebLn} from "src/engine"
  import {router} from "src/app/util"
  import {myZenBalance, refreshMyZenBalance} from "src/util/zen"

  // Derive current user's profile for MULTIPASS detection
  const myProfile = deriveProfile($pubkey)

  // Refresh ZEN balance when profile has Ğ1 address
  $: {
    const p = $myProfile as any
    if (p?.g1v2 || p?.g1pub) {
      refreshMyZenBalance({g1v2: p.g1v2, g1pub: p.g1pub})
    }
  }

  $: hasMultipass = !!($myProfile as any)?.g1pub || !!($myProfile as any)?.g1v2
</script>

<div class="flex flex-col gap-6">
  <div class="flex justify-between">
    <div class="flex items-center gap-2">
      <i class="fa fa-server fa-lg" />
      <h2 class="staatliches text-2xl">{$_("wallet.title")}</h2>
    </div>
    {#if $session?.wallet}
      <div class="flex items-center gap-2 text-sm text-success">
        <i class="fa fa-check" />
        {$_("wallet.connected")}
      </div>
    {:else}
      <Link modal class="btn btn-accent" href={router.at("settings/wallet/connect").toString()}>
        {$_("wallet.connectWallet")}
      </Link>
    {/if}
  </div>
  <div class="flex flex-col gap-4">
    {#if $session?.wallet}
      {#if $session.wallet?.type === "webln"}
        {@const {node, version} = $session.wallet.info}
        <div class="flex flex-col justify-between gap-2 lg:flex-row">
          <p>
            {$_("wallet.connectedTo", {values: {name: node?.alias || version || "unknown wallet", type: $session.wallet.type}})}
          </p>
          <p class="flex gap-2 whitespace-nowrap">
            {$_("wallet.balance")}
            {#await getWebLn()
              ?.enable()
              .then(() => getWebLn().getBalance())}
              <span class="loading loading-spinner loading-sm"></span>
            {:then res}
              {new Intl.NumberFormat(LOCALE).format(res?.balance || 0)}
            {:catch}
              [unknown]
            {/await}
            {$_("wallet.sats")}
          </p>
        </div>
      {:else if $session.wallet.type === "nwc"}
        {@const {lud16, relayUrl, nostrWalletConnectUrl} = $session.wallet.info}
        <div class="flex flex-col justify-between gap-2 lg:flex-row">
          <p>
            {$_("wallet.connectedTo", {values: {name: lud16, type: displayRelayUrl(relayUrl)}})}
          </p>
          <p class="flex gap-2 whitespace-nowrap">
            {$_("wallet.balance")}
            {#await new nwc.NWCClient({nostrWalletConnectUrl}).getBalance()}
              <span class="loading loading-spinner loading-sm"></span>
            {:then res}
              {new Intl.NumberFormat(LOCALE).format(fromMsats(res?.balance || 0))}
            {:catch}
              [unknown]
            {/await}
            {$_("wallet.sats")}
          </p>
        </div>
      {/if}
      <Link modal class="btn" href={router.at("settings/wallet/disconnect").toString()}>
        <Icon icon="close-circle" />
        {$_("wallet.disconnectWallet")}
      </Link>
    {:else}
      <p class="py-12 text-center opacity-75">{$_("wallet.noWalletConnected")}</p>
    {/if}
  </div>
</div>

<!-- ─── MULTIPASS ẐEN section ─── -->
<div class="mt-8 flex flex-col gap-6">
  <div class="flex items-center gap-2">
    <i class="fa fa-coins fa-lg text-accent" />
    <h2 class="staatliches text-2xl">MULTIPASS ẐEN</h2>
  </div>

  <div class="flex flex-col gap-4 rounded border border-solid border-tinted-600 p-4">
    {#if hasMultipass}
      <!-- Balance display -->
      <div class="flex items-center justify-between">
        <span class="text-sm text-tinted-400">{$_("wallet.zenBalance")}</span>
        <span class="staatliches text-2xl text-accent">
          {$myZenBalance >= 0 ? $myZenBalance : "…"} ẐEN
        </span>
      </div>
      <p class="text-sm text-tinted-400">
        {$_("wallet.zenDesc")}
      </p>
    {:else}
      <div class="flex flex-col gap-3">
        <p class="text-sm text-tinted-300">
          {$_("wallet.zenNoMultipass")}
        </p>
        <Link
          modal
          class="btn btn-accent self-start"
          href={router.at("people").of($pubkey).toString()}>
          <i class="fa fa-user-pen" />
          {$_("wallet.editProfile")}
        </Link>
      </div>
    {/if}
  </div>

  <p class="text-xs text-tinted-500">
    {$_("wallet.zenFormula")}
  </p>
</div>
