import { defineConfig } from "vitepress"

// GitHub Pages serves the project site under /bpmn-cli/: the docs workflow
// (.github/workflows/docs.yml) sets DOCS_BASE accordingly. Local dev and
// preview keep the default "/".
const base = process.env.DOCS_BASE ?? "/"

export default defineConfig({
  base,
  lang: "en-US",
  // The product name (corporate design: a tool is "Miragon" plus its name);
  // the npm package keeps its @miragon/bpmn-cli name and the command `bpmn`.
  title: "Miragon bpmn-cli",
  description:
    "A command line tool and Claude Code plugin that lets an AI agent edit BPMN 2.0 models by naming elements, while the CLI writes the XML and keeps the drawing.",
  cleanUrls: true,
  lastUpdated: true,

  // Notes for maintainers, read on GitHub: not pages of the site.
  srcExclude: ["releasing.md", "testing.md", "audit-2026-10.md"],

  // Code blocks sit on --cd-grau (light) and a white lift of --cd-schwarz
  // (dark). There, github-light-high-contrast and github-dark-default keep
  // every token colour at WCAG AA (the lowest, comments, at 4.72:1 and
  // 4.98:1); VitePress' default pair github-light/github-dark and
  // github-light-default (comments 4.26:1 on --cd-grau) don't.
  markdown: {
    theme: { light: "github-light-high-contrast", dark: "github-dark-default" },
    // Headings get GitHub's anchors (lower case, punctuation but - and _
    // dropped, each space a -), so the pages' links, written for reading on
    // GitHub, also hold here: "Changes from 0.6" is #changes-from-06 on both.
    anchor: {
      slugify: (title: string) =>
        title
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
          .replace(/ /g, "-"),
    },
  },

  head: [
    // The app icon of Miragon software: the green Komet on the blue tile,
    // the CI's file unchanged. Head links are not rewritten for `base`.
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}logo/miragon-komet-blau.svg` }],
    // CI primary blue (--cd-blau) for the browser chrome
    ["meta", { name: "theme-color", content: "#335DE5" }],
  ],

  // Preload the self-hosted Geist (hashed file name, so a static head link
  // can't point at it; see vitepress.dev site-config#transformhead).
  transformHead({ assets }) {
    const geist = assets.find((file) => /geist-latin-wght-normal\.[\w-]+\.woff2$/.test(file))
    if (!geist) return
    return [
      ["link", { rel: "preload", href: geist, as: "font", type: "font/woff2", crossorigin: "" }],
    ]
  },

  themeConfig: {
    // The official wordmarks: green (the standard) on light, white on dark.
    logo: {
      light: "/logo/miragon-logo-gruen.svg",
      dark: "/logo/miragon-logo-weiss.svg",
      alt: "Miragon",
    },
    // A product shows the wordmark and writes its name next to it in Geist;
    // the wordmark already reads MIRAGON, so the nav reads "MIRAGON bpmn-cli"
    // (and its link's accessible name "Miragon bpmn-cli").
    siteTitle: "bpmn-cli",
    nav: [
      {
        text: "Getting started",
        link: "/getting-started",
        activeMatch: "^/(getting-started|claude-code-plugin|walkthrough)",
      },
      { text: "Commands", link: "/commands", activeMatch: "^/(commands|ops|camunda|layout|bpmnlint)" },
      { text: "Library", link: "/library", activeMatch: "^/(library|validators)" },
      { text: "Reference", link: "/reference", activeMatch: "^/(reference|contract|migrating)" },
      { text: "miragon.ai", link: "https://miragon.ai/tools/bpmn-cli/" },
    ],

    // One sidebar for every page: the CLI is small enough to show it all.
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "Claude Code plugin", link: "/claude-code-plugin" },
          { text: "A worked session", link: "/walkthrough" },
        ],
      },
      {
        text: "Using the CLI",
        items: [
          { text: "Commands", link: "/commands" },
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
        text: "Reference",
        items: [
          { text: "Reference", link: "/reference" },
          { text: "The contract and its limits", link: "/contract" },
          { text: "Migrating", link: "/migrating" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/Miragon/bpmn-cli" }],

    outline: { level: [2, 3] },

    search: { provider: "local" },

    editLink: {
      pattern: "https://github.com/Miragon/bpmn-cli/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    // A plain date in the site's language ("Oct 11, 2026"), not the reader's
    // short date and time ("10/11/26, 10:44 AM").
    lastUpdated: {
      text: "Last updated",
      formatOptions: { dateStyle: "medium", forceLocale: true },
    },

    // Say what happened and what to do, in sentence case (VitePress' default
    // is an all-caps "PAGE NOT FOUND" and a quote).
    notFound: {
      title: "This page doesn't exist",
      quote: "The link may be outdated. Search the docs, or start at the docs home.",
      linkLabel: "Go to the docs home",
      linkText: "Go to the docs home",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © Miragon",
    },
  },
})
