<script lang="ts">
  import {_} from "svelte-i18n"
  import {get} from "svelte/store"
  import {pubkey} from "@welshman/app"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import {resolveApiUrl} from "src/util/uplanet-detect"
  import Heading from "src/partials/Heading.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Button from "src/partials/Button.svelte"
  import Field from "src/partials/Field.svelte"
  import Input from "src/partials/Input.svelte"
  import Textarea from "src/partials/Textarea.svelte"
  import {router} from "src/app/util/router"

  let title = ""
  let description = ""
  let sending = false

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      return showWarning($_("feedbackCreate.missingFields"))
    }

    sending = true

    try {
      const apiUrl = await resolveApiUrl()
      const formData = new FormData()

      formData.append("title", title)
      formData.append("description", description)
      formData.append("source", "coracle")
      formData.append("category", "bug")
      formData.append("platform", "web")

      const hash = import.meta.env.VITE_BUILD_HASH
      if (hash) formData.append("app_version", hash)

      const p = get(pubkey)
      if (p) formData.append("pubkey", p)

      const res = await fetch(`${apiUrl}/api/feedback`, {method: "POST", body: formData})
      const data = await res.json()

      if (data.ok) {
        showInfo($_("feedbackCreate.sent"))
        router.pop()
      } else {
        showWarning($_("feedbackCreate.failed"))
      }
    } catch (err) {
      showWarning($_("feedbackCreate.failed"))
    } finally {
      sending = false
    }
  }
</script>

<form on:submit|preventDefault={submit}>
  <FlexColumn>
    <Heading class="text-center">{$_("feedbackCreate.title")}</Heading>
    <Field label={$_("feedbackCreate.issueTitle")}>
      <Input bind:value={title} placeholder={$_("feedbackCreate.issueTitlePlaceholder")} />
    </Field>
    <Field label={$_("feedbackCreate.issueDescription")}>
      <Textarea
        bind:value={description}
        placeholder={$_("feedbackCreate.issueDescriptionPlaceholder")} />
    </Field>
    <Button class="btn btn-accent" type="submit" loading={sending}>
      {$_("feedbackCreate.send")}
    </Button>
  </FlexColumn>
</form>
