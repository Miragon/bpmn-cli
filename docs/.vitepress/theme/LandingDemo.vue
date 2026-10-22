<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { withBase } from "vitepress"

const command = 'bpmn add order.bpmn userTask "Approve invoice" --after Activity_CheckInvoice'

// The first paint (and reduced motion) shows the end state, so the demo never opens on an empty terminal.
const typedChars = ref(command.length)
const shownLines = ref(3)
const typing = ref(false)
const changed = ref(true)

let timer: ReturnType<typeof setTimeout> | undefined
const after = (ms: number, step: () => void) => {
  timer = setTimeout(step, ms)
}

function restart() {
  typedChars.value = 0
  shownLines.value = 0
  changed.value = false
  typing.value = true
  after(700, typeCommand)
}

function typeCommand() {
  if (typedChars.value < command.length) {
    typedChars.value += 1
    return after(32, typeCommand)
  }
  typing.value = false
  after(350, showOutput)
}

function showOutput() {
  changed.value = true
  if (shownLines.value < 3) {
    shownLines.value += 1
    return after(260, showOutput)
  }
  after(5500, restart)
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  after(3500, restart)
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <figure class="window" aria-label="bpmn add inserts an Approve invoice task into order.bpmn">
    <div class="titlebar">
      <span class="dots" aria-hidden="true"><i /><i /><i /></span>
      <span>order.bpmn</span>
    </div>
    <div class="canvas" data-cd-theme="light">
      <div class="pane">
        <img
          :class="{ hidden: changed }"
          :src="withBase('/shots/landing-demo-before.svg')"
          alt=""
          aria-hidden="true"
        />
        <img
          :class="{ hidden: !changed }"
          :src="withBase('/shots/landing-demo-after.svg')"
          alt="The order process after the command: Check invoice, then Approve invoice, then Done"
        />
      </div>
    </div>
    <div class="terminal">
      <p class="line"><span class="prompt">$ </span>{{ command.slice(0, typedChars) }}<span v-if="typing" class="caret" aria-hidden="true" /></p>
      <p class="line" :class="{ pending: shownLines < 1 }"><span class="ok">created</span> userTask Activity_ApproveInvoice "Approve invoice" - after Activity_CheckInvoice</p>
      <p class="line quiet" :class="{ pending: shownLines < 2 }">note: inserted between Activity_CheckInvoice and Event_Done</p>
      <p class="line" :class="{ pending: shownLines < 3 }"><span class="ok">written:</span> order.bpmn</p>
    </div>
  </figure>
</template>

<style scoped>
.window {
  width: 100%;
  margin: 0;
  border: 1px solid var(--cd-ui-kontur);
  border-radius: var(--cd-radius-md);
  background: var(--cd-ui-seite);
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--cd-ui-linie);
  font: 500 13px/1 var(--vp-font-family-mono);
}
.dots {
  display: flex;
  gap: 6px;
}
.dots i {
  width: 9px;
  height: 9px;
  border: 1px solid var(--cd-ui-kontur);
  border-radius: 50%;
}

.canvas {
  padding: 20px 16px;
  border-bottom: 1px solid var(--cd-ui-linie);
  background: var(--cd-ui-seite);
}
.pane {
  display: grid;
}
.pane img {
  grid-area: 1 / 1;
  width: 100%;
  height: auto;
  transition: opacity 0.6s var(--cd-ease);
}
.pane img.hidden {
  opacity: 0;
  transition: none;
}

.terminal {
  min-height: 122px;
  padding: 16px 18px;
  background: var(--cd-ui-flaeche);
  font: 400 12px/1.65 var(--vp-font-family-mono);
  color: var(--cd-ui-text);
}
.line {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.line.pending {
  visibility: hidden;
}
.prompt {
  color: var(--cd-ui-link);
  user-select: none;
}
.ok {
  color: var(--cd-ui-link);
}
.quiet {
  color: var(--cd-ui-text-leise);
}
.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 1px;
  vertical-align: -2px;
  background: var(--cd-ui-text);
}

@media (prefers-reduced-motion: reduce) {
  .pane img {
    transition: none;
  }
}
</style>
