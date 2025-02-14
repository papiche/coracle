<script lang="ts">
  import {onMount} from "svelte"
  import {derived} from "svelte/store"
  import {partition, max, pushToMapKey} from "@welshman/lib"
  import type {TrustedEvent} from "@welshman/util"
  import {getAncestorTagValues, SEEN_GENERAL, REACTION} from "@welshman/util"
  import {formatTimestampAsDate} from "src/util/misc"
  import NotificationList from "src/app/views/NotificationList.svelte"
  import NotificationReactions from "src/app/views/NotificationReactions.svelte"
  import {reactionNotifications, unreadReactionNotifications, markAsSeen} from "src/engine"

  export let limit

  const notifications = derived(reactionNotifications, $events => {
    const eventsByKey = new Map<string, TrustedEvent[]>()

    for (const event of $events) {
      const [parentId] = getAncestorTagValues(event.tags).replies

      // Group and sort by day/event so we can cluster interactions with the same event
      const date = formatTimestampAsDate(event.created_at)
      const key = ["reaction", parentId, date].join(":")

      pushToMapKey(eventsByKey, key, event)
    }

    return Array.from(eventsByKey.entries()).map(([key, interactions]) => {
      const [type, root] = key.split(":")
      const timestamp = max(interactions.map(e => e.created_at))

      return {key, type, root, timestamp, interactions}
    })
  })

  let loading = false

  onMount(() => {
    const tracked = new Set()

    const unsub = unreadReactionNotifications.subscribe(async events => {
      const untracked = events.filter(e => !tracked.has(e.id))

      if (!loading && untracked.length > 0) {
        for (const id of untracked) {
          tracked.add(id)
        }

        const [reactions, zaps] = partition(e => e.kind === REACTION, $reactionNotifications)

        loading = true

        await markAsSeen(SEEN_GENERAL, {reactions, zaps})

        loading = false
      }
    })

    return unsub
  })
</script>

<NotificationList notifications={$notifications} {limit}>
  <div slot="notification" let:notification>
    <NotificationReactions {notification} />
  </div>
</NotificationList>
