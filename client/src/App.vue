<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'

// При переходе в другую комнату страница создаётся заново (новое подключение).
const route = useRoute()
const roomKey = computed(() => String(route.params.code ?? '-'))
</script>

<template>
  <RouterView :key="roomKey" />
</template>
