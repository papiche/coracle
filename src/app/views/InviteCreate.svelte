<script lang="ts">
  import {_} from "svelte-i18n"
  import {relaySearch, pubkey, deriveProfileDisplay} from "@welshman/app"
  import {identity, without} from "@welshman/lib"
  import {displayRelayUrl} from "@welshman/util"
  import PersonSelect from "src/app/shared/PersonSelect.svelte"
  import {router} from "src/app/util/router"
  import Button from "src/partials/Button.svelte"
  import Card from "src/partials/Card.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Heading from "src/partials/Heading.svelte"
  import Input from "src/partials/Input.svelte"
  import Link from "src/partials/Link.svelte"
  import ListItem from "src/partials/ListItem.svelte"
  import SearchSelect from "src/partials/SearchSelect.svelte"
  import Subheading from "src/partials/Subheading.svelte"
  import Textarea from "src/partials/Textarea.svelte"
  import {pickVals, toSpliced} from "src/util/misc"
  import {copyToClipboard} from "src/util/html"
  import {showInfo} from "src/partials/Toast.svelte"
  import {getIpfsGateway} from "src/util/ipfs"
  import {onMount} from "svelte"

  export let initialPubkey = null

  const keygenUrl = `${getIpfsGateway()}/ipns/copylaradio.com/g1.html`
  const senderName = deriveProfileDisplay($pubkey)

  let emailSubject = ""
  let emailBody = ""

  const initEmailDraft = () => {
    emailSubject = $_("inviteCreate.emailSubject")
    emailBody = $_("inviteCreate.emailBody", {values: {url: keygenUrl, name: $senderName}})
  }

  $: mailtoHref = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`

  const copySubject = () => {
    copyToClipboard(emailSubject)
    showInfo($_("inviteCreate.copied"))
  }

  const copyBody = () => {
    copyToClipboard(emailBody)
    showInfo($_("inviteCreate.copied"))
  }

  const showSection = section => {
    sections = [...sections, section]

    if (section === "email" && !emailBody) {
      initEmailDraft()
    }
  }

  const hideSection = section => {
    sections = without([section], sections)

    if (section === "people") {
      pubkeys = []
    }

    if (section === "relays") {
      relays = []
    }
  }

  const addRelay = url => {
    if (url) {
      relayInput.clear()
      relays = [...relays, {url, claim: ""}]
    }
  }

  const removeRelay = i => {
    relays = toSpliced(relays, i, 1)
  }

  let relayInput
  let sections = []
  let pubkeys = []
  let relays = []

  const onSubmit = () => {
    const invite: any = {}

    if (sections.includes("people")) {
      invite.people = pubkeys.join(",")
    }

    if (sections.includes("relays")) {
      invite.relays = relays.map(r => pickVals(["url", "claim"], r).join("|")).join(",")
    }

    router
      .at("qrcode")
      .of(window.origin + "/invite?" + new URLSearchParams(invite).toString())
      .open()
  }

  onMount(() => {
    if (initialPubkey) {
      showSection("people")
      pubkeys = pubkeys.concat(initialPubkey)
    }

    // Not sure why, but the inputs are getting automatically focused
    setTimeout(() => (document.activeElement as any).blur())
  })
</script>

<div class="mb-4 flex flex-col items-center justify-center">
  <Heading>{$_("inviteCreate.title")}</Heading>
  <p>
    {$_("inviteCreate.description")}
  </p>
</div>
{#each sections as section (section)}
  {#if section === "people"}
    <Card>
      <FlexColumn>
        <div class="flex justify-between">
          <Subheading>{$_("inviteCreate.people")}</Subheading>
          <i class="fa fa-times cursor-pointer" on:click={() => hideSection("people")} />
        </div>
        <p>{$_("inviteCreate.suggestPeople")}</p>
        <PersonSelect multiple bind:value={pubkeys} />
      </FlexColumn>
    </Card>
  {:else if section === "relays"}
    <Card>
      <FlexColumn>
        <div class="flex justify-between">
          <Subheading>{$_("inviteCreate.relays")}</Subheading>
          <i class="fa fa-times cursor-pointer" on:click={() => hideSection("relays")} />
        </div>
        <p>
          {$_("inviteCreate.inviteRelaysDescription")}
        </p>
        {#each relays as relay, i (relay.url + i)}
          <ListItem on:remove={() => removeRelay(i)}>
            <span slot="label">{displayRelayUrl(relay.url)}</span>
            <span slot="data">
              <Input bind:value={relay.claim} placeholder={$_("inviteCreate.claimOptional")} />
            </span>
          </ListItem>
        {/each}
        <SearchSelect
          value={null}
          bind:this={relayInput}
          search={$relaySearch.searchValues}
          termToItem={identity}
          onChange={url => addRelay(url)}>
          <i slot="before" class="fa fa-search" />
          <div slot="item" let:item>
            {displayRelayUrl(item)}
          </div>
        </SearchSelect>
      </FlexColumn>
    </Card>
  {:else if section === "email"}
    <Card>
      <FlexColumn>
        <div class="flex justify-between">
          <Subheading>{$_("inviteCreate.email")}</Subheading>
          <i class="fa fa-times cursor-pointer" on:click={() => hideSection("email")} />
        </div>
        <p>{$_("inviteCreate.emailDescription")}</p>
        <div class="flex items-end gap-2">
          <Input bind:value={emailSubject} class="flex-grow" />
          <Button on:click={copySubject}><i class="fa fa-copy" /></Button>
        </div>
        <div class="flex items-end gap-2">
          <Textarea bind:value={emailBody} class="flex-grow" rows={10} />
          <Button on:click={copyBody}><i class="fa fa-copy" /></Button>
        </div>
        <Link class="btn btn-accent" external href={mailtoHref}>
          <i class="fa fa-envelope" />
          {$_("inviteCreate.openInMailClient")}
        </Link>
      </FlexColumn>
    </Card>
  {/if}
{/each}
<div class="flex justify-end gap-4">
  <Button disabled={sections.includes("people")} on:click={() => showSection("people")}>
    <i class="fa fa-plus" />
    {$_("inviteCreate.addPeople")}
  </Button>
  <Button disabled={sections.includes("relays")} on:click={() => showSection("relays")}>
    <i class="fa fa-plus" />
    {$_("inviteCreate.addRelays")}
  </Button>
  <Button disabled={sections.includes("email")} on:click={() => showSection("email")}>
    <i class="fa fa-plus" />
    {$_("inviteCreate.addEmail")}
  </Button>
</div>
<Button class="btn btn-accent" disabled={[...pubkeys, ...relays].length === 0} on:click={onSubmit}>
  {$_("inviteCreate.createLink")}
</Button>
