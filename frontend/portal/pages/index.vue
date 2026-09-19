<script setup lang="ts">
const INGESTION = 'http://localhost:8181'
const { worldBrainUrl, aiServiceUrl } = useRuntimeConfig().public

const { data: events, pending } = await useFetch<any[]>('/events?limit=24', {
  baseURL: INGESTION,
  default: () => [],
})

const DOMAIN_COLORS: Record<string, string> = {
  energy: '#f59e0b',
  cities: '#10b981',
  transport: '#06b6d4',
  finance: '#ec4899',
}

const list = computed(() => events.value ?? [])

const counts = computed(() => {
  const out: Record<string, number> = {}
  for (const e of list.value) out[e.domain] = (out[e.domain] ?? 0) + 1
  return out
})

const worst = computed(() =>
  list.value.reduce((max: number, e: any) => (e.severity > max ? e.severity : max), 0),
)

const domainColor = (domain: string) => DOMAIN_COLORS[domain] ?? '#64748b'
const time = (ts: string) => (ts ? new Date(ts).toLocaleTimeString() : '—')
</script>

<template>
  <main class="page">
    <header class="hero">
      <div class="brand">
        <span class="mark" aria-hidden="true" />
        <div>
          <h1>GAIA — Public Portal</h1>
          <p class="tagline">live simulation feed · {{ list.length }} recent events</p>
        </div>
      </div>
      <nav class="nav">
        <a :href="worldBrainUrl">Open World Brain ↗</a>
        <a :href="`${aiServiceUrl}/docs`">AI API docs ↗</a>
      </nav>
    </header>

    <section class="stats">
      <div class="stat">
        <span class="stat-label">events shown</span>
        <span class="stat-value">{{ list.length }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">peak severity</span>
        <span class="stat-value" :style="{ color: worst > 0.5 ? '#f87171' : '#37e0a2' }">
          {{ worst.toFixed(2) }}
        </span>
      </div>
      <div class="stat">
        <span class="stat-label">status</span>
        <span class="stat-value" :style="{ color: pending ? '#fbbf24' : '#37e0a2' }">
          {{ pending ? 'syncing' : 'live' }}
        </span>
      </div>
    </section>

    <section class="domains">
      <span
        v-for="d in ['energy', 'cities', 'transport', 'finance']"
        :key="d"
        class="domain-chip"
        :style="{ '--c': domainColor(d) }"
      >
        <i /> {{ d }} <b>{{ counts[d] ?? 0 }}</b>
      </span>
    </section>

    <ul v-if="list.length" class="feed">
      <li v-for="e in list" :key="e.id" :style="{ '--c': domainColor(e.domain) }">
        <span class="tick">#{{ e.tick }}</span>
        <span class="domain">{{ e.domain }}</span>
        <span class="type">{{ e.type }}</span>
        <span class="region">{{ e.region }}</span>
        <span class="sev">
          <i :style="{ width: `${Math.min(100, e.severity * 100)}%` }" />
        </span>
        <span class="value">{{ e.severity.toFixed(2) }}</span>
        <span class="time">{{ time(e.ts) }}</span>
      </li>
    </ul>

    <p v-else class="empty">
      No live events yet — start the ingestion service on <code>http://localhost:8181</code>.
    </p>
  </main>
</template>
