import { StudiApp } from "./app/StudiApp";
import { mountRenderer } from "./renderer";

if (import.meta.env.DEV && new URLSearchParams(location.search).has("preview")) {
  void import("./preview/main").then(({ startPreview }) => startPreview());
} else {
  mountRenderer(<StudiApp />);
}
