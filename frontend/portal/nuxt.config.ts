export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      aiServiceUrl: process.env.AI_URL || 'http://localhost:8091',
      worldBrainUrl: process.env.WORLD_BRAIN_URL || 'http://localhost:4302',
    },
  },
  server: {
    host: '0.0.0.0',
  },
});