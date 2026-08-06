<script lang="ts">
  import cx from "classnames"
  import type {Editor} from "@welshman/editor"
  import Modal from "src/partials/Modal.svelte"
  import UdriveBrowser from "src/app/shared/UdriveBrowser.svelte"
  import {insertUdriveFile} from "src/app/editor"
  import type {UdriveFile} from "src/util/zen"

  export let editor: Editor

  let open = false

  const onSelect = (file: UdriveFile, url: string) => {
    insertUdriveFile(editor, file, url)
    open = false
  }
</script>

<i class={cx("fa fa-hdd cursor-pointer", $$props.class)} on:click={() => (open = true)} />

{#if open}
  <Modal onEscape={() => (open = false)}>
    <UdriveBrowser {onSelect} />
  </Modal>
{/if}
