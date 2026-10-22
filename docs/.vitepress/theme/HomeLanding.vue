<script setup lang="ts">
import { ref } from "vue"
import { withBase } from "vitepress"
import LandingDemo from "./LandingDemo.vue"

const installs = [
  { name: "Claude Code", prompt: ">", lines: ["/plugin marketplace add Miragon/bpmn-cli", "/plugin install bpmn-cli@miragon-bpmn"] },
  { name: "npm", prompt: "$", lines: ["npm install -g @miragon/bpmn-cli"] },
  { name: "Homebrew", prompt: "$", lines: ["brew install miragon/tap/bpmn-cli"] },
]
const steps = [
  { name: "Read", link: "/commands#show-and-find", command: "bpmn show", effect: "Prints the model as text." },
  { name: "Change", link: "/commands#add", command: "bpmn add · set · apply", effect: "Writes XML and drawing together." },
  { name: "Look", link: "/commands#render", command: "bpmn render", effect: "Draws the picture the agent sees." },
  { name: "Check", link: "/camunda", command: "bpmn validate", effect: "Flags what the engine would refuse." },
]

const selected = ref(0)
const copied = ref(false)

function selectBy(offset: number) {
  selected.value = (selected.value + offset + installs.length) % installs.length
}

async function copyInstall() {
  await navigator.clipboard.writeText(installs[selected.value].lines.join("\n"))
  copied.value = true
  setTimeout(() => (copied.value = false), 1600)
}
</script>

<template>
  <div class="landing">
    <section class="hero">
      <div class="frame hero-frame">
        <div class="pitch">
          <h1>bpmn-cli</h1>
          <p class="slogan">Your agent edits the model, not the XML.</p>
          <p class="lede">
            A CLI and Claude Code plugin for BPMN 2.0. Your drawing stays, and Camunda 7 and 8 deploy
            rules are checked before the engine sees the file.
          </p>

          <div class="install">
            <div class="tabs" role="tablist" aria-label="Install" @keydown.right.prevent="selectBy(1)" @keydown.left.prevent="selectBy(-1)">
              <button
                v-for="(install, index) in installs"
                :key="install.name"
                class="tab"
                role="tab"
                :aria-selected="index === selected"
                :tabindex="index === selected ? 0 : -1"
                @click="selected = index"
              >
                {{ install.name }}
              </button>
            </div>
            <div class="command" role="tabpanel">
              <pre><template v-for="line in installs[selected].lines" :key="line"><span class="prompt">{{ installs[selected].prompt }} </span>{{ line }}
</template></pre>
              <button class="copy" type="button" @click="copyInstall">{{ copied ? "Copied" : "Copy" }}</button>
            </div>
          </div>
          <p class="meta">
            <span>Needs Node 22.12+</span>
            <span class="pre-release">
              <span class="marker" aria-hidden="true" />
              <span><strong>Pre-1.0:</strong> pin the version, a minor can break a command.</span>
            </span>
          </p>
          <a class="start" :href="withBase('/getting-started')">Get started <span aria-hidden="true">→</span></a>
        </div>

        <div class="stage">
          <LandingDemo />
        </div>
      </div>
    </section>

    <section class="loop" aria-label="Why and how it works">
      <div class="frame">
        <div class="explainer">
          <div class="point">
            <h2>Why</h2>
            <p>
              As XML, the task in the demo is 1,254 bytes in 7 places, mostly coordinates: slow and costly
              for a model to write, and easy to break. As a command it is 76 characters, and the CLI refuses
              any change that would break the model.
            </p>
          </div>
          <div class="point">
            <h2 id="how-it-works">How it works</h2>
            <p>
              Your agent works on the model like on code: it reads it as text, changes it by id, looks at the
              drawing and checks it. It repeats the loop until the check is clean.
            </p>
          </div>
        </div>
        <ol class="steps">
          <li v-for="(step, index) in steps" :key="step.name" class="step">
            <div class="rail">
              <span class="node">0{{ index + 1 }}</span>
              <span v-if="index === steps.length - 1" class="back">→ 01</span>
            </div>
            <h3>
              <a :href="withBase(step.link)">{{ step.name }} <span class="go" aria-hidden="true">→</span></a>
            </h3>
            <code>{{ step.command }}</code>
            <p>{{ step.effect }}</p>
          </li>
        </ol>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  --gutter: 32px;
  --line: 1px solid var(--cd-ui-linie);
  display: flex;
  flex-direction: column;
  border-top: var(--line);
}

/* The frame lines up with the navigation bar above it. */
.frame {
  width: 100%;
  max-width: var(--vp-layout-max-width);
  margin: 0 auto;
}
@media (min-width: 1441px) {
  .frame {
    border-right: var(--line);
    border-left: var(--line);
  }
}

/* Hero: name, install and status on the left, the demo on the right, split 50/50. */
.hero {
  flex: 1;
  display: flex;
  min-height: 0;
}
.hero-frame {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.pitch {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px var(--gutter);
  border-bottom: var(--line);
}
h1 {
  margin: 0;
  font-size: clamp(56px, 8.4vh, 80px);
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.045em;
}
.slogan {
  margin: 14px 0 0;
  font-size: 24px;
  line-height: 1.3;
  font-weight: 500;
  letter-spacing: -0.015em;
  text-wrap: balance;
}
.lede {
  max-width: 46ch;
  margin: 14px 0 0;
  color: var(--cd-ui-text-leise);
  line-height: 1.55;
}

.install {
  margin-top: 28px;
  border: var(--line);
  border-radius: var(--cd-radius-sm);
  background: var(--cd-ui-abschnitt);
}
.tabs {
  display: flex;
  border-bottom: var(--line);
}
.tab {
  position: relative;
  padding: 11px 14px;
  border-right: var(--line);
  font: 500 13px/1 var(--vp-font-family-mono);
  color: var(--cd-ui-text-leise);
}
.tab:first-child {
  border-top-left-radius: var(--cd-radius-sm);
}
.tab[aria-selected="true"] {
  color: var(--cd-ui-text);
  background: var(--cd-ui-seite);
}
.tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: var(--cd-ui-interaktion);
}
.command {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 12px 12px 16px;
}
.command pre {
  flex: 1;
  min-width: 0;
  margin: 0;
  font: 400 14px/1.7 var(--vp-font-family-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.command .prompt {
  color: var(--cd-ui-text-leise);
  user-select: none;
}
.copy {
  flex: none;
  height: 32px;
  padding: 0 10px;
  border: var(--line);
  border-radius: var(--cd-radius-sm);
  font: 500 12px/1 var(--vp-font-family-mono);
  color: var(--cd-ui-text);
}
.copy:hover {
  background: var(--cd-ui-hover);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 20px;
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--cd-ui-text-leise);
}
.meta > span:first-child {
  font: 400 12px/1.5 var(--vp-font-family-mono);
}
.pre-release {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--cd-ui-text);
}
.pre-release strong {
  font: 500 12px/1 var(--vp-font-family-mono);
}
.marker {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--cd-ui-warning);
}
.start {
  align-self: flex-start;
  margin-top: 24px;
  font-weight: 600;
  color: var(--cd-ui-link);
  text-decoration: none;
}
.start:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

/* The demo stands on a quiet grid, the drawing surface of a modeler. */
.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 32px var(--gutter);
  background-image:
    linear-gradient(var(--cd-ui-linie) 1px, transparent 1px),
    linear-gradient(90deg, var(--cd-ui-linie) 1px, transparent 1px);
  background-size: 32px 32px;
  background-position: -1px -1px;
}

/* The loop: one sentence on how to picture it, then the four steps on one rail. */
.loop {
  flex: none;
  border-top: var(--line);
}
.explainer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border-bottom: var(--line);
}
.point {
  padding: 14px var(--gutter) 16px;
}
.point + .point {
  border-top: var(--line);
}
.point h2 {
  margin: 0 0 4px;
  padding: 0;
  border: 0;
  font: 500 12px/20px var(--vp-font-family-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--cd-ui-text-leise);
}
.point p {
  margin: 0;
  font-size: 15px;
  line-height: 23px;
}
.steps {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  padding: 0 var(--gutter) 24px;
}
.rail {
  position: relative;
  display: flex;
  align-items: center;
  height: 56px;
}
.rail::before {
  content: "";
  position: absolute;
  top: 50%;
  right: calc(-1 * var(--gutter));
  left: calc(-1 * var(--gutter));
  height: 2px;
  margin-top: -1px;
  background: var(--cd-ui-icon-akzent);
}
.step:first-child .rail::before {
  left: 0;
}
.step:last-child .rail::before {
  right: 0;
}
.step:not(:last-child) .rail::after {
  content: "";
  position: absolute;
  top: 50%;
  right: calc(-1 * var(--gutter) + 6px);
  margin-top: -5px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid var(--cd-ui-icon-akzent);
}
.node {
  position: relative;
  display: inline-grid;
  place-items: center;
  height: 26px;
  min-width: 34px;
  padding: 0 6px;
  border: 2px solid var(--cd-ui-icon-akzent);
  border-radius: 4px;
  background: var(--cd-ui-seite);
  font: 500 12px/1 var(--vp-font-family-mono);
}
.back {
  position: relative;
  margin-left: auto;
  padding: 4px 0 4px 10px;
  background: var(--cd-ui-seite);
  font: 500 12px/1 var(--vp-font-family-mono);
  color: var(--cd-ui-text-leise);
}
.step h3 {
  margin: 2px 0 10px;
  font-size: 26px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.step h3 a {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  color: inherit;
  text-decoration: none;
}
.step h3 a:hover {
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-decoration-color: var(--cd-ui-interaktion);
  text-underline-offset: 5px;
}
.go {
  font: 500 18px/1 var(--vp-font-family-mono);
  color: var(--cd-ui-text-leise);
  transition: transform var(--cd-motion-fast) var(--cd-ease), color var(--cd-motion-fast) var(--cd-ease);
}
.step h3 a:hover .go {
  color: var(--cd-ui-link);
  transform: translateX(3px);
}
.step code {
  display: block;
  padding: 6px 10px;
  border: var(--line);
  border-radius: 4px;
  background: var(--cd-ui-abschnitt);
  font: 400 14px/1.5 var(--vp-font-family-mono);
}
.step p {
  margin: 10px 0 0;
  font-size: 15px;
  color: var(--cd-ui-text-leise);
}

@media (min-width: 960px) {
  .hero-frame {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pitch {
    border-right: var(--line);
    border-bottom: 0;
  }
  .explainer {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .point + .point {
    border-top: 0;
    border-left: var(--line);
  }
  .steps {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .step {
    border-right: var(--line);
  }
  .step:last-child {
    border-right: 0;
  }
}

/* One screen on desktop: navigation, hero, loop and the legal row (53px) fill the viewport; on a
   short screen the page grows and scrolls instead of squeezing the hero. */
@media (min-width: 960px) and (min-height: 700px) {
  .landing {
    min-height: calc(100dvh - var(--vp-nav-height) - 53px);
  }
  .pitch {
    padding-top: 20px;
    padding-bottom: 20px;
  }
  h1 {
    font-size: clamp(48px, 7vh, 72px);
  }
  .slogan,
  .lede {
    margin-top: 10px;
  }
  .install {
    margin-top: 20px;
  }
  .start {
    margin-top: 16px;
  }
  .stage {
    container-type: size;
  }
  .stage :deep(.window) {
    width: min(100%, calc((100cqh - 64px - 214px) * 4.25 + 34px));
  }
  .stage :deep(.terminal) {
    font-size: 11px;
    line-height: 1.6;
  }
}

@media (max-width: 640px) {
  .landing {
    --gutter: 20px;
  }
  .pitch {
    padding: 44px var(--gutter) 40px;
  }
  h1 {
    font-size: 56px;
  }
  .slogan {
    font-size: 21px;
  }
  .stage {
    padding: 24px 12px;
  }
  .command {
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .command pre {
    width: 100%;
    font-size: 12px;
  }
  .copy {
    align-self: flex-end;
  }
  .step {
    display: grid;
    grid-template-columns: 34px 1fr;
    column-gap: 16px;
    padding: 0 var(--gutter);
  }
  .rail {
    grid-row: 1 / span 3;
    flex-direction: column;
    align-items: center;
    height: auto;
    padding-top: 22px;
  }
  .rail::before {
    top: 0;
    right: auto;
    bottom: 0;
    left: 50%;
    width: 2px;
    height: auto;
    margin: 0 0 0 -1px;
  }
  .step:first-child .rail::before {
    top: 34px;
    left: 50%;
  }
  .step:last-child .rail::before {
    right: auto;
    bottom: auto;
    height: 35px;
  }
  .step:not(:last-child) .rail::after {
    top: auto;
    right: auto;
    bottom: 4px;
    left: 50%;
    margin: 0 0 0 -5px;
    border-top: 8px solid var(--cd-ui-icon-akzent);
    border-right: 5px solid transparent;
    border-bottom: 0;
    border-left: 5px solid transparent;
  }
  .back {
    display: none;
  }
  .step h3 {
    margin: 20px 0 10px;
    font-size: 24px;
  }
  .step p {
    padding-bottom: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .go {
    transition: none;
  }
}
</style>
