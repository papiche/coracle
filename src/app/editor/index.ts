import "@welshman/editor/index.css"

import type {Writable} from "svelte/store"
import {get} from "svelte/store"
import type {UploadTask, FileAttributes} from "@welshman/editor"
import {first} from "@welshman/lib"
import {getTagValue, getListTags} from "@welshman/util"
import {Router} from "@welshman/router"
import {pubkey, profileSearch, userBlossomServerList} from "@welshman/app"
import {npubEncode} from "nostr-tools/nip19"
import {Editor, MentionSuggestion, WelshmanExtension, editorProps} from "@welshman/editor"
import {ensureProto} from "src/util/misc"
import {getVerifiedUPlanet} from "src/util/uplanet-detect"
import {env} from "src/engine/state"
import {uploadFile} from "src/engine/commands"
import type {UdriveFile} from "src/util/zen"
import {MentionNodeView} from "./MentionNodeView"
import ProfileSuggestion from "./ProfileSuggestion.svelte"

/** Insert an already-uploaded uDRIVE file into the editor without re-uploading it. */
export const insertUdriveFile = (editor: Editor, file: UdriveFile, url: string) => {
  if (file.type === "image" || file.type === "video") {
    editor.commands.insertContent({type: file.type, attrs: {src: url, alt: file.name}})
  } else {
    editor.commands.insertContent({
      type: "text",
      text: file.name,
      marks: [{type: "link", attrs: {href: url}}],
    })
  }
}

export const makeEditor = ({
  aggressive = false,
  autofocus = false,
  content = "",
  placeholder = "",
  submit,
  onUpdate,
  onUploadError,
  uploading,
  charCount,
  wordCount,
}: {
  aggressive?: boolean
  autofocus?: boolean
  content?: string
  placeholder?: string
  submit: () => void
  onUpdate?: () => void
  onUploadError?: (task: UploadTask) => void
  uploading?: Writable<boolean>
  charCount?: Writable<number>
  wordCount?: Writable<number>
}) =>
  new Editor({
    content,
    autofocus,
    editorProps,
    extensions: [
      WelshmanExtension.configure({
        submit,
        extensions: {
          placeholder: {
            config: {
              placeholder,
            },
          },
          breakOrSubmit: {
            config: {
              aggressive,
            },
          },
          fileUpload: {
            config: {
              upload: async (attrs: FileAttributes) => {
                const userServer = getTagValue("server", getListTags(get(userBlossomServerList)))

                // Try UPlanet upload when no user-configured server
                const up = !userServer && getVerifiedUPlanet()
                if (up) {
                  try {
                    const formData = new FormData()
                    formData.append("file", attrs.file)
                    // Envoyer le npub de l'utilisateur courant pour que le serveur
                    // puisse nommer le fichier et l'associer à son profil
                    const currentPubkey = get(pubkey)
                    if (currentPubkey) {
                      try {
                        formData.append("npub", npubEncode(currentPubkey))
                      } catch {
                        // pubkey invalide — on continue sans npub
                      }
                    }
                    formData.append("type", "media")
                    const res = await fetch(up.uploadUrl, {method: "POST", body: formData})
                    if (res.ok) {
                      const data = await res.json()
                      if (data.url) return {result: {url: data.url, tags: []}}
                    }
                  } catch {
                    // fall through to Blossom
                  }
                }

                const server = ensureProto(userServer || first(env.BLOSSOM_URLS))

                try {
                  let {uploaded, url, ...task} = await uploadFile(server, attrs.file)

                  if (!uploaded) {
                    return {error: "Server refused to process the file"}
                  }

                  // Always append file extension if missing
                  if (new URL(url).pathname.split(".").length === 1) {
                    url += "." + attrs.file.type.split("/")[1]
                  }

                  const result = {...task, url, tags: []}

                  return {result}
                } catch (e) {
                  return {error: e.toString()}
                }
              },
              onDrop(currentEditor, file: File) {
                uploading?.set(true)
                setTimeout(() => {
                  const files = currentEditor.storage.fileUpload.getFiles()

                  // Hack to fix bug with immediateUpload
                  if (files.some(f => f.src.startsWith("blob:") && !f.uploading)) {
                    currentEditor.commands.uploadFiles()
                  }
                })
              },
              onComplete() {
                uploading?.set(false)
              },
              onUploadError(currentEditor, task: UploadTask) {
                currentEditor.commands.removeFailedUploads()
                onUploadError?.(task)
                uploading?.set(false)
              },
            },
          },
          nprofile: {
            extend: {
              addNodeView: () => MentionNodeView,
              addProseMirrorPlugins() {
                return [
                  MentionSuggestion({
                    editor: (this as any).editor,
                    search: (term: string) => get(profileSearch).searchValues(term),
                    getRelays: (pubkey: string) => Router.get().FromPubkey(pubkey).getUrls(),
                    createSuggestion: (value: string) => {
                      const target = document.createElement("div")

                      new ProfileSuggestion({target, props: {value}})

                      return target
                    },
                  }),
                ]
              },
            },
          },
        },
      }),
    ],
    onUpdate({editor}) {
      onUpdate?.()
      wordCount?.set(editor.storage.wordCount.words)
      charCount?.set(editor.storage.wordCount.chars)
    },
  })
