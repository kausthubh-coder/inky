import assert from "node:assert/strict";
import test from "node:test";
import { configureAppNavigation } from "../../dist/electron/app-navigation.js";

test("chat links open externally while app navigation and unsafe destinations stay blocked", async () => {
  let openWindow;
  let navigate;
  const opened = [];
  configureAppNavigation(
    {
      setWindowOpenHandler: (handler) => {
        openWindow = handler;
      },
      on: (event, handler) => {
        assert.equal(event, "will-navigate");
        navigate = handler;
      },
    },
    async (url) => {
      opened.push(url);
    },
  );

  const allowed = [
    "https://mail.google.com/mail/u/0/#inbox/example",
    "http://localhost:4174/",
    "mailto:teacher@example.com",
  ];
  for (const url of [
    ...allowed,
    "javascript:alert(1)",
    "file:///C:/secret.txt",
    "data:text/html,hello",
    "studi://auth",
    "/relative",
    "//example.com",
  ]) {
    assert.deepEqual(openWindow({ url }), { action: "deny" });
  }
  assert.deepEqual(opened, allowed);
  let prevented = false;
  navigate({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
});
