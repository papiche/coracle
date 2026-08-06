<script lang="ts">
  import cx from "classnames"
  import {showWarning} from "src/partials/Toast.svelte"
  import {uploadEncryptedImage} from "src/util/uplanetChannels"
  import {sendEncryptedImageDM} from "src/engine"

  // 1:1 DMs only — kind-4 NIP-44 has no notion of multiple recipients like
  // the NIP-59 gift-wrapped group chats do.
  export let recipient: string

  let input: HTMLInputElement
  let sending = false

  const pick = () => input.click()

  const onChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    sending = true

    try {
      const envelope = await uploadEncryptedImage(file)
      await sendEncryptedImageDM(recipient, envelope)
    } catch (err: any) {
      showWarning(`Failed to send encrypted image: ${err?.message || err}`)
    } finally {
      sending = false
      input.value = ""
    }
  }
</script>

<input bind:this={input} type="file" accept="image/*" class="hidden" on:change={onChange} />

<i
  class={cx("fa cursor-pointer", sending ? "fa-circle-notch fa-spin" : "fa-lock", $$props.class)}
  on:click={pick} />
