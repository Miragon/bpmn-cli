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
  srcExclude: ["releasing.md", "testing.md", "adr/**"],

  nav: [
    { text: "Getting started", link: "/getting-started", activeMatch: "^/(getting-started|modeling|camunda|layout|bpmnlint|library)" },
    { text: "Reference", link: "/commands", activeMatch: "^/(commands|contract)" },
  ],

  sidebar: [
    {
      text: "Start",
      items: [{ text: "Getting started", link: "/getting-started" }],
    },
    {
      text: "Guides",
      items: [
        { text: "Model a process", link: "/modeling" },
        { text: "Camunda 7 and 8", link: "/camunda" },
        { text: "Layout", link: "/layout" },
        { text: "bpmnlint", link: "/bpmnlint" },
        { text: "Library", link: "/library" },
      ],
    },
    {
      text: "Reference",
      items: [
        { text: "Commands", link: "/commands" },
        { text: "Guarantees and limits", link: "/contract" },
      ],
    },
    {
      text: "Contributing",
      items: [{ text: "Architecture", link: "/architecture" }],
    },
  ],
})
