import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";

import "./custom.css";

/**
 * Extends VitePress's default theme purely to load `./custom.css` (see that file for why).
 * No component overrides, layout slots, or app-level customization are needed — this exists
 * solely as the required entry point for the CSS override (see
 * https://vitepress.dev/guide/extending-default-theme#customizing-css).
 */
export default {
  extends: DefaultTheme
} satisfies Theme;
