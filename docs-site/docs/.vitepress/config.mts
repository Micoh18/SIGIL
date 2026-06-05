import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Mr Mainspring Docs",
  description:
    "Developer documentation for the Mr Mainspring MCP backend: memory, Grimoire, Casper anchoring, x402 payments, and audit trails.",
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  markdown: {
    lineNumbers: false
  },
  themeConfig: {
    logo: "/sigil-mark.svg",
    siteTitle: "Mr Mainspring",
    search: {
      provider: "local"
    },
    outline: {
      level: [2, 3],
      label: "On this page"
    },
    nav: [
      { text: "Overview", link: "/" },
      { text: "Quickstart", link: "/quickstart" },
      { text: "MCP Tools", link: "/mcp-tools" },
      {
        text: "Context: local backend",
        items: [
          { text: "Current Limitations", link: "/current-limitations" },
          { text: "Local Demo", link: "/local-demo" },
          { text: "API/Schema Reference", link: "/api-schema-reference" }
        ]
      },
      {
        text: "LLM",
        items: [
          { text: "llms.txt", link: "/llms.txt" },
          { text: "llms-full.txt", link: "/llms-full.txt" },
          { text: "Tool Schemas", link: "/api/tool-schemas.json" }
        ]
      }
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Quickstart", link: "/quickstart" },
          { text: "Architecture", link: "/architecture" },
          { text: "Local Demo", link: "/local-demo" }
        ]
      },
      {
        text: "Core Modules",
        items: [
          { text: "MCP Tools", link: "/mcp-tools" },
          { text: "Memory", link: "/memory" },
          { text: "Grimoire", link: "/grimoire" },
          { text: "Payments and x402", link: "/payments-x402" },
          { text: "Casper Anchoring", link: "/casper-anchoring" },
          { text: "Audit Trail", link: "/audit-trail" }
        ]
      },
      {
        text: "Reference",
        items: [
          { text: "Security Model", link: "/security-model" },
          { text: "API/Schema Reference", link: "/api-schema-reference" },
          { text: "Current Limitations", link: "/current-limitations" }
        ]
      }
    ],
    footer: {
      message: "Mr Mainspring docs are generated from repo-local source content and MCP schema data.",
      copyright: "Current milestone: local backend and honest pre-settlement flows."
    }
  }
});
