<script lang="ts">
  import {now, formatTimestamp, MINUTE, HOUR, DAY} from "@welshman/lib"
  import {getTagValue} from "@welshman/util"
  import Popover from "src/partials/Popover.svelte"

  export let tags: string[][]

  const formatTimeLeft = (seconds: number) => {
    const delta = seconds - now()

    if (delta <= 0) return "expired"
    if (delta < HOUR) return `${Math.ceil(delta / MINUTE)}m`
    if (delta < DAY) return `${Math.ceil(delta / HOUR)}h`

    return `${Math.ceil(delta / DAY)}d`
  }

  $: expiresAt = parseInt(getTagValue("expiration", tags) || "") || null
</script>

{#if expiresAt}
  <Popover triggerType="mouseenter">
    <i slot="trigger" class="fa fa-clock cursor-pointer text-neutral-400" />
    <p slot="tooltip">
      {#if expiresAt - now() > 0}
        Expires in {formatTimeLeft(expiresAt)} ({formatTimestamp(expiresAt)})
      {:else}
        Expired {formatTimestamp(expiresAt)}
      {/if}
    </p>
  </Popover>
{/if}
