// Onboarding prototype. Not product code: it borrows the app's CSS, characters and preview fixtures.
// Open http://127.0.0.1:4174/docs/redesign/onboarding/proto/ while `bun run preview:ui` runs.
import { StudiApp } from "../../../../desktop/src/app/StudiApp.js";
import { mountRenderer } from "../../../../desktop/src/renderer.js";
import { installDevPreview } from "../../../../desktop/src/preview/fixtures.js";
import { Onboarding } from "./Onboarding.js";
import { Tour } from "./Tour.js";
import "./proto.css";

const params = new URLSearchParams(location.search);
if (params.has("tour")) {
  installDevPreview();
  mountRenderer(<><StudiApp /><Tour step={Number(params.get("tour"))} /></>);
} else {
  mountRenderer(<Onboarding />);
}
