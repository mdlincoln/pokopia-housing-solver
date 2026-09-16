import { createBootstrap } from 'bootstrap-vue-next'
import { createPinia } from 'pinia'
import posthog from 'posthog-js'
import { createApp } from 'vue'

import 'bootstrap-icons/font/bootstrap-icons.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
import 'bootstrap/dist/css/bootstrap.css'
import './styles/tropical-theme.css'

import App from './App.vue'
import router from './router'

// PostHog is initialized ONLY when a real token is present at build time.
// `import.meta.env.VITE_*` is statically replaced during `npm run build`, so
// local dev and CI `npm run preview` (which serve builds without the token)
// never initialize PostHog and never send analytics. The production deploy
// injects the repository secret `VITE_POSTHOG_TOKEN` into its build step.
const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_TOKEN
if (POSTHOG_TOKEN) {
  posthog.init(POSTHOG_TOKEN, {
    api_host: 'https://b.matthewlincoln.net',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
  })
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
// The `rtl: { localeInitial: 'en' }` config matters for accessibility:
// bootstrap-vue-next's useRtl composable (mounted by every BFormSpinbutton)
// mirrors its locale onto <html lang>. Without a registered locale it writes
// lang="" — blanking the static lang="en" from index.html and failing axe's
// `html-has-lang` rule. 'en' + non-RTL is the app's actual posture.
app.use(createBootstrap({ rtl: { localeInitial: 'en', rtlInitial: false } }))

app.config.errorHandler = (err, _instance, _info) => {
  posthog.captureException(err)
}

app.mount('#app')
