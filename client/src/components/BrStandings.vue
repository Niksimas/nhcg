<script setup lang="ts">
// Турнирная таблица «Брейн-ринга»: бои, победы, ничьи, поражения, взятые вопросы и сквозной счёт.
import { computed } from 'vue'
import type { BrStanding, Competitor } from '../lib/types'
import { fmtScore, textOn } from '../lib/util'

const props = withDefaults(
  defineProps<{
    standings: BrStanding[]
    competitors: Competitor[]
    highlight?: string[]
    variant?: 'host' | 'screen'
    winnerId?: string | null
  }>(),
  { highlight: () => [], variant: 'host', winnerId: null },
)

const byId = computed(() => new Map(props.competitors.map((c) => [c.id, c])))
const rows = computed(() => props.standings.filter((r) => byId.value.has(r.competitorId)))
</script>

<template>
  <table class="standings" :class="variant">
    <thead>
      <tr>
        <th class="place">#</th>
        <th class="name">{{ competitors[0]?.kind === 'team' ? 'Команда' : 'Игрок' }}</th>
        <th title="Сыграно боёв">Бои</th>
        <th title="Победы">В</th>
        <th title="Ничьи">Н</th>
        <th title="Поражения">П</th>
        <th title="Взято вопросов во всех боях">Взято</th>
        <th class="total" title="Сквозной счёт турнира">Очки</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(r, i) in rows"
        :key="r.competitorId"
        :class="{ hl: highlight.includes(r.competitorId), win: winnerId === r.competitorId }"
        :style="{ '--c': byId.get(r.competitorId)?.color ?? '#888', '--t': textOn(byId.get(r.competitorId)?.color ?? '#888') }"
      >
        <td class="place nums">{{ i + 1 }}</td>
        <td class="name">
          <span class="dot" />
          <span class="ellipsis">{{ byId.get(r.competitorId)?.name }}</span>
        </td>
        <td class="nums">{{ r.played }}</td>
        <td class="nums">{{ r.wins }}</td>
        <td class="nums">{{ r.draws }}</td>
        <td class="nums">{{ r.losses }}</td>
        <td class="nums">{{ r.taken }}</td>
        <td class="total nums">{{ fmtScore(r.total) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.standings {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 4px;
}
th {
  font-size: 0.75em;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: center;
  padding: 0 0.4em;
}
th.name {
  text-align: left;
}
td {
  background: var(--panel-2);
  padding: 0.35em 0.5em;
  text-align: center;
}
td:first-child {
  border-radius: 8px 0 0 8px;
}
td:last-child {
  border-radius: 0 8px 8px 0;
}
td.name {
  text-align: left;
  max-width: 0;
  width: 40%;
}
td.name {
  display: table-cell;
}
td.name .dot {
  display: inline-block;
  width: 0.7em;
  height: 0.7em;
  border-radius: 50%;
  background: var(--c);
  margin-right: 0.5em;
  vertical-align: middle;
}
td.name .ellipsis {
  vertical-align: middle;
}
td.total {
  font-weight: 900;
  color: var(--accent);
}
tr.hl td {
  background: color-mix(in srgb, var(--c) 25%, var(--panel-2));
}
tr.win td {
  background: color-mix(in srgb, var(--accent) 22%, var(--panel-2));
}
.place {
  width: 2.2em;
  color: var(--muted);
}
.screen {
  font-size: clamp(1rem, 2.1vw, 1.9rem);
}
.screen td {
  padding: 0.35em 0.7em;
  background: rgba(20, 29, 63, 0.85);
}
</style>
