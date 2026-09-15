<script setup lang="ts">
const { data: alerts } = await useFetch('/events?limit=20', {
  baseURL: 'http://localhost:8181',
})
</script>

<template>
  <main class="page">
    <h1>GAIA — Public Portal</h1>
    <p>Live simulated world: explore regions, subscribe to alerts.</p>
    <ul v-if="alerts?.length">
      <li v-for="a in alerts" :key="a.id">{{ a.type }} — {{ a.region }} (sev {{ a.severity.toFixed(2) }})</li>
    </ul>
    <p v-else>Aucune alerte en cours.</p>
  </main>
</template>