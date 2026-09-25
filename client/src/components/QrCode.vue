<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'

const props = withDefaults(defineProps<{ text: string; dark?: string; light?: string }>(), {
  dark: '#0a0f24',
  light: '#ffffff',
})

const svg = ref('')

watchEffect(async () => {
  const text = props.text
  if (!text) {
    svg.value = ''
    return
  }
  try {
    svg.value = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: props.dark, light: props.light },
    })
  } catch {
    svg.value = ''
  }
})
</script>

<template>
  <div class="qr" v-html="svg" />
</template>

<style scoped>
.qr {
  line-height: 0;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}
.qr :deep(svg) {
  width: 100%;
  height: auto;
  display: block;
}
</style>
