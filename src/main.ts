import { createBootstrap } from 'bootstrap-vue-next'
import { createPinia } from 'pinia'
import posthog from 'posthog-js'
import { createApp } from 'vue'

import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
import 'bootstrap/dist/css/bootstrap.css'
import './styles/tropical-theme.css'

import App from './App.vue'
import router from './router'

posthog.init(
  import.meta.env.VITE_POSTHOG_TOKEN || 'phc_tOVguqjWzuJaJmpxvho8ifms2nxCnypWeJD5Dd9bSoW',
  {
    api_host: 'https://b.matthewlincoln.net',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
  },
)

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createBootstrap())

app.config.errorHandler = (err, _instance, _info) => {
  posthog.captureException(err)
}

app.mount('#app')
