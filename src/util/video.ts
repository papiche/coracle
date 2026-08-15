import type {TrustedEvent} from "@welshman/util"
import {getTagValue, getTagValues} from "@welshman/util"
import {resolveIpfsUrl} from "src/util/ipfs"

export interface VideoInfo {
  title: string
  videoUrl: string
  thumbUrl: string
  gifanimUrl: string
  duration: number
  isShort: boolean
  topics: string[]
  // Subset of topics with structural/boilerplate tags (film, movie, series,
  // tv-show, youtube, video, webcam, live, short, regular, Channel-*) removed —
  // what's left is the actual TMDB genres (action, science-fiction, …).
  genres: string[]
  sourceType: string
  // Series metadata (published by ajouter_media.sh / publish_nostr_video.sh for source:serie)
  seriesName: string
  episodeName: string
  seasonNumber: number | null
  episodeNumber: number | null
}

// "t" tag values that publish_nostr_video.sh adds for structure/routing, not
// as user-facing genres — must be excluded when displaying genre chips.
const STRUCTURAL_TAGS = new Set([
  "film",
  "movie",
  "series",
  "serie",
  "tv-show",
  "youtube",
  "video",
  "webcam",
  "live",
  "short",
  "regular",
  "nostr",
  "local",
])

const isStructuralTag = (tag: string) =>
  STRUCTURAL_TAGS.has(tag.toLowerCase()) || /^channel-/i.test(tag)

const findTag = (tags: string[][], keys: string[]) => {
  for (const key of keys) {
    const val = getTagValue(key, tags)
    if (val) return val
  }
  return ""
}

/** Extract playback info from a NIP-71 video note (kind 21/22). */
export const extractVideoInfo = (event: TrustedEvent): VideoInfo => {
  const {tags} = event

  const imetaTag = tags.find(t => t[0] === "imeta")
  let imetaUrl = ""
  if (imetaTag) {
    for (let i = 1; i < imetaTag.length; i++) {
      if (typeof imetaTag[i] === "string" && imetaTag[i].startsWith("url ")) {
        imetaUrl = imetaTag[i].substring(4).trim()
      }
    }
  }

  const sourceTag = tags.find(t => t[0] === "i" && t[1]?.startsWith("source:"))
  const sourceType = sourceTag
    ? sourceTag[1].replace("source:", "")
    : tags.some(t => t[0] === "t" && t[1] === "youtube")
      ? "youtube"
      : tags.some(t => t[0] === "t" && t[1] === "film")
        ? "film"
        : tags.some(t => t[0] === "t" && t[1] === "serie")
          ? "serie"
          : "local"

  const duration = parseInt(findTag(tags, ["duration"]) || "0")

  const seasonRaw = findTag(tags, ["season_number"])
  const episodeRaw = findTag(tags, ["episode_number"])

  const topics = getTagValues("t", tags)
  const genres = topics.filter(t => t && !isStructuralTag(t))

  return {
    title: findTag(tags, ["title"]) || "Video",
    videoUrl: resolveIpfsUrl(findTag(tags, ["url", "r"]) || imetaUrl),
    thumbUrl: resolveIpfsUrl(findTag(tags, ["image", "thumb", "thumbnail_ipfs"])),
    gifanimUrl: resolveIpfsUrl(findTag(tags, ["gifanim", "gif", "gifanim_ipfs"])),
    duration,
    isShort: event.kind === 22 || duration <= 60,
    topics,
    genres,
    sourceType,
    seriesName: findTag(tags, ["series_name"]),
    episodeName: findTag(tags, ["episode_name"]),
    seasonNumber: seasonRaw ? parseInt(seasonRaw) : null,
    episodeNumber: episodeRaw ? parseInt(episodeRaw) : null,
  }
}
