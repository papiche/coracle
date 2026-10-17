<script lang="ts">
  import {fromPairs} from "@welshman/lib"
  import {urlIsMedia} from "@welshman/content"
  import Card from "src/partials/Card.svelte"
  import Chip from "src/partials/Chip.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import NoteContentLinks from "src/app/shared/NoteContentLinks.svelte"
  import NoteContentTopics from "src/app/shared/NoteContentTopics.svelte"
  import PersonBadge from "src/app/shared/PersonBadge.svelte"

  export let note
  export let showMedia = false

  const {title, summary, image, status, p, streaming} = fromPairs(note.tags) as Record<string, string>

  // Le lien est celui que l'auteur annonce lui-même dans son événement (tag "streaming" :
  // salle de visio UPlanet…), jamais un service tiers. Seul https est suivi.
  const href = streaming && /^https:\/\//i.test(streaming) ? streaming : null
</script>

<svelte:element this={href ? "a" : "div"} {...href ? {href, target: "_blank", rel: "noopener noreferrer"} : {}}>
  <Card interactive={Boolean(href)}>
    <FlexColumn>
      {#if p}
        <PersonBadge pubkey={p} />
      {/if}
      <div class="flex items-center justify-between gap-2">
        <p class="staatliches text-2xl">{title}</p>
        <Chip class="text-sm">
          <i class="fa fa-sm fa-tower-broadcast" />
          {status}
        </Chip>
      </div>
      {#if summary}
        <p>{summary}</p>
      {/if}
      {#if showMedia && image && urlIsMedia(image)}
        <NoteContentLinks urls={[image]} showMedia />
      {/if}
      <NoteContentTopics {note} />
    </FlexColumn>
  </Card>
</svelte:element>
