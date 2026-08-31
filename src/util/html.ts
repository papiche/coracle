import logger from "src/util/logger"

export const copyToClipboard = text => {
  const {activeElement} = document
  const input = document.createElement("textarea")

  input.innerHTML = text
  document.body.appendChild(input)
  input.select()

  const result = document.execCommand("copy")

  document.body.removeChild(input)
  ;(activeElement as HTMLElement).focus()

  return result
}

export type CompressorOpts = {
  quality?: number
  maxWidth?: number
  maxHeight?: number
}

export const stripExifData = async (file, opts: CompressorOpts = {}) => {
  if (window.DataTransferItem && file instanceof DataTransferItem) {
    file = file.getAsFile()
  }

  if (!file) {
    return file
  }

  const {default: Compressor} = await import("compressorjs")

  return new Promise((resolve, _reject) => {
    new Compressor(file, {
      ...opts,
      maxWidth: 2048,
      maxHeight: 2048,
      success: resolve,
      error: e => {
        logger.warn("Failed to compress file", e)
        // Non-images break compressor
        if (e.toString().includes("File or Blob")) {
          return resolve(file)
        }

        _reject(e)
      },
    })
  })
}

export const listenForFile = (input, onChange) => {
  input.addEventListener("change", async e => {
    const target = e.target as HTMLInputElement

    if (target.files.length > 0) {
      onChange(Array.from(target.files))
    } else {
      onChange(null)
    }
  })
}

export const blobToString = async blob =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = reject
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })

export const stripHtml = html => {
  const doc = new DOMParser().parseFromString(html, "text/html")

  return doc.body.textContent || ""
}

export const escapeHtml = html => {
  const div = document.createElement("div")

  div.innerText = html

  return div.innerHTML
}

/**
 * Upsert Open Graph / Twitter Card <meta> tags for link-preview purposes.
 * Client-side only, so it has no effect on classic crawlers that don't
 * execute JS (Twitter/Facebook/Telegram's basic unfurlers) — by the time
 * this runs, they've already fetched and parsed the static index.html. Real
 * cross-platform previews need server-side rendering, which this static SPA
 * doesn't have (see UPassport/templates/theater-modal.html for the
 * server-templated equivalent). Still worth doing for anything that *does*
 * render JS (in-app shares, headless-rendering unfurlers, browser tooling).
 */
export const setSocialMeta = (meta: {title?: string; description?: string; image?: string}) => {
  const upsert = (attr: "property" | "name", key: string, content?: string) => {
    if (!content) return

    let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)

    if (!tag) {
      tag = document.createElement("meta")
      tag.setAttribute(attr, key)
      document.head.appendChild(tag)
    }

    tag.setAttribute("content", content)
  }

  upsert("property", "og:title", meta.title)
  upsert("property", "og:description", meta.description)
  upsert("property", "og:image", meta.image)
  upsert("name", "twitter:title", meta.title)
  upsert("name", "twitter:description", meta.description)
  upsert("name", "twitter:image", meta.image)
}

export const isMobile =
  localStorage.mobile || window.navigator.maxTouchPoints > 1 || window.innerWidth < 400

export const parseHex = hex => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)

  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
}
