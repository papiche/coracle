<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {_} from "svelte-i18n"
  import {detectUPlanetServices} from "src/util/uplanet-detect"

  const uplanet = detectUPlanetServices()
  // UPassport serves vocals.html at /vocals on the u. API server
  const vocalsUrl = uplanet ? `${uplanet.apiUrl}/vocals` : null

  let iframeEl: HTMLIFrameElement

  /**
   * Bridge NOSTR signing requests from the vocals.html iframe to the
   * browser's window.nostr extension.
   * vocals.html already includes a postMessage proxy (see the NOSTR Extension
   * Proxy block at the top of the file) that sends:
   *   { type: 'nostr-request', requestId, method, params }
   * and expects:
   *   { type: 'nostr-response', requestId, success, data | error }
   */
  const handleMessage = async (event: MessageEvent) => {
    if (!event.data || event.data.type !== "nostr-request") return
    if (!iframeEl?.contentWindow) return

    const {requestId, method, params} = event.data
    const nostr = (window as any).nostr

    const reply = (success: boolean, data?: any, error?: string) =>
      iframeEl?.contentWindow?.postMessage(
        {type: "nostr-response", requestId, success, data, error},
        "*",
      )

    try {
      if (!nostr) throw new Error("No NOSTR extension available")

      let result: any

      switch (method) {
        case "getPublicKey":
          result = await nostr.getPublicKey()
          break
        case "signEvent":
          result = await nostr.signEvent(params[0])
          break
        case "nip44.encrypt":
          result = await nostr.nip44.encrypt(params[0], params[1])
          break
        case "nip44.decrypt":
          result = await nostr.nip44.decrypt(params[0], params[1])
          break
        case "nip04.encrypt":
          result = await nostr.nip04?.encrypt(params[0], params[1])
          break
        case "nip04.decrypt":
          result = await nostr.nip04?.decrypt(params[0], params[1])
          break
        default:
          throw new Error(`Unknown NOSTR method: ${method}`)
      }

      reply(true, result)
    } catch (err: any) {
      reply(false, undefined, err?.message || "Unknown error")
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)
  })

  onDestroy(() => {
    window.removeEventListener("message", handleMessage)
  })

  document.title = $_("menu.vocaux")
</script>

{#if vocalsUrl}
  <!--
    Full-height iframe embedding the UPassport vocals.html page.
    The NOSTR signing bridge (handleMessage above) forwards postMessage
    requests from the iframe to the browser extension, then relays the response.
    The "allow" attribute grants the iframe access to microphone, camera and
    geolocation which are required to record voice/video messages.
  -->
  <iframe
    bind:this={iframeEl}
    src={vocalsUrl}
    title={$_("vocaux.title")}
    class="h-full w-full border-0"
    style="height: calc(100vh - 60px);"
    allow="microphone; camera; geolocation" />
{:else}
  <div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
    <i class="fa fa-microphone-slash fa-3x text-tinted-500" />
    <p class="text-lg text-tinted-400">{$_("vocaux.noUplanet")}</p>
    <p class="text-sm text-tinted-500">{$_("vocaux.noUplanetDesc")}</p>
  </div>
{/if}
