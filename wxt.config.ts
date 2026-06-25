import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  manifest: {
    name: "Bili Dynamic Groups",
    description: "Group Bilibili dynamic feeds and surface unread updates.",
    permissions: ["alarms", "storage"],
    host_permissions: ["https://*.bilibili.com/*"],
    action: {
      default_title: "Bili Dynamic Groups"
    },
    options_ui: {
      page: "options/index.html",
      open_in_tab: true
    },
    browser_specific_settings: {
      gecko: {
        id: "bili-dynamic-groups@example.local"
      }
    }
  },
  vite: () => ({
    plugins: [preact()]
  })
});
