// The docs site, built with the Miragon docs kit (docs/.vitepress/miragon/, vendored from
// Miragon/corporate-identity, skill docs-site). The kit sets everything else: base from
// DOCS_BASE, theme, colours light and dark, GitHub anchors, Mermaid, search, the legal row.
import { miragonDocs } from "./miragon/config"

export default miragonDocs({
  repo: "Miragon/bpmn-cli",
  // The product name (corporate design: a tool is "Miragon" plus its name); the npm package
  // keeps its @miragon/bpmn-cli name and the command `bpmn`.
  title: "Miragon bpmn-cli",
  siteTitle: "bpmn-cli",
  description:
    "A command line tool and Claude Code plugin that lets an AI agent edit BPMN 2.0 models by naming elements, while the CLI writes the XML and keeps the drawing.",
  productPage: "https://miragon.ai/tools/bpmn-cli/",
  footerMessage: "Released under the MIT License.",

  // Notes for maintainers, read on GitHub: not pages of the site.
  srcExclude: ["releasing.md", "testing.md"],

  nav: [
    {
      text: "Getting started",
      link: "/getting-started",
      activeMatch: "^/(getting-started|claude-code-plugin|walkthrough|contract)",
    },
    { text: "Commands", link: "/commands", activeMatch: "^/(commands|reference|ops|camunda|layout|bpmnlint)" },
    { text: "Library", link: "/library", activeMatch: "^/(library|validators)" },
  ],

  // One sidebar for every page: the CLI is small enough to show it all.
  sidebar: [
    {
      text: "Start",
      items: [
        { text: "Getting started", link: "/getting-started" },
        { text: "Claude Code plugin", link: "/claude-code-plugin" },
        { text: "A worked session", link: "/walkthrough" },
        { text: "Guarantees and limits", link: "/contract" },
      ],
    },
    {
      text: "Using the CLI",
      items: [
        { text: "Commands", link: "/commands" },
        { text: "Syntax and output", link: "/reference" },
        { text: "Ops JSON (bpmn apply)", link: "/ops" },
        { text: "Camunda 7 and Camunda 8", link: "/camunda" },
        { text: "Layout and formatting", link: "/layout" },
        { text: "bpmnlint", link: "/bpmnlint" },
      ],
    },
    {
      text: "Library",
      items: [
        { text: "Library use", link: "/library" },
        { text: "Validators", link: "/validators" },
      ],
    },
    {
      text: "Contributing",
      items: [
        { text: "Architecture", link: "/architecture" },
      ],
    },
  ],
})
