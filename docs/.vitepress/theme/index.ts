// The theme of the Miragon docs kit (docs/.vitepress/miragon/theme/), unchanged, plus this site's own
// parts: the landing page (HomeLanding.vue with the animated LandingDemo.vue), diagram cards and
// wrapped CLI output (custom.css). Own styles use the roles --cd-ui-* only.
import MiragonTheme from "../miragon/theme"
import HomeLanding from "./HomeLanding.vue"
import "./custom.css"

export default {
  extends: MiragonTheme,
  enhanceApp({ app }) {
    app.component("HomeLanding", HomeLanding)
  },
}
