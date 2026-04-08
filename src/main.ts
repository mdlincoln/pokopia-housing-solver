import { createBootstrap } from 'bootstrap-vue-next'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
import 'bootstrap/dist/css/bootstrap.css'
import './styles/tropical-theme.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createBootstrap())

app.mount('#app')
