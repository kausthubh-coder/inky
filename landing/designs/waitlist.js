(function () {
  const KEY = "studi-waitlist-email";

  function joined() {
    try { return Boolean(window.localStorage.getItem(KEY)); }
    catch { return false; }
  }

  function save(email) {
    const value = (email || "").trim().toLowerCase();
    if (!value || !value.includes("@") || !value.includes(".")) return false;
    try { window.localStorage.setItem(KEY, value); } catch { /* ignore */ }
    return true;
  }

  function paintJoined(root) {
    root.querySelectorAll("[data-waitlist]").forEach((form) => { form.hidden = true; });
    root.querySelectorAll(".ok-msg").forEach((msg) => { msg.classList.add("on"); });
  }

  function bind(root) {
    if (joined()) paintJoined(root);
    root.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-waitlist]");
      if (!form || !root.contains(form)) return;
      event.preventDefault();
      const input = form.querySelector("input[type='email']");
      if (!save(input && input.value)) {
        if (input) input.focus();
        return;
      }
      paintJoined(root);
    });
  }

  window.StudiWaitlist = { joined, save, bind, paintJoined };
})();
