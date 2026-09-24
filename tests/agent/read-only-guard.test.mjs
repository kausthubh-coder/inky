import assert from "node:assert/strict";
import test from "node:test";

import { classifyScanRequest, installScanReadOnlyGuard } from "../../dist/electron/browser/read-only-guard.js";

test("session guard blocks scan form, fetch, and XHR writes but leaves assignment writes enabled", () => {
  const webRequest = fakeWebRequest();
  const blocked = [];
  const guard = installScanReadOnlyGuard(
    { webRequest },
    { onBlocked: request => blocked.push(request) },
  );

  assert.deepEqual(webRequest.request({ method: "POST", resourceType: "mainFrame" }), {});

  guard.setScanActive(true);
  assert.deepEqual(webRequest.request({ method: "POST", resourceType: "mainFrame" }), { cancel: true });
  assert.deepEqual(webRequest.request({ method: "POST", resourceType: "xhr" }), { cancel: true });
  assert.deepEqual(webRequest.request({ method: "PUT", resourceType: "xhr" }), { cancel: true });
  assert.deepEqual(webRequest.request({ method: "PATCH", resourceType: "xhr" }), { cancel: true });
  assert.deepEqual(webRequest.request({ method: "DELETE", resourceType: "xhr" }), { cancel: true });
  assert.equal(blocked.length, 5);

  guard.setScanActive(false);
  assert.deepEqual(webRequest.request({ method: "POST", resourceType: "xhr" }), {});
});

test("scan guard allows GET and HEAD while active", () => {
  for (const method of ["GET", "HEAD", "get"]) {
    assert.deepEqual(classifyScanRequest(request({ method })), { action: "allow", reason: "read" });
  }
});

test("only exact named sign-in hosts bypass scan write blocking", () => {
  const options = { signInHosts: ["login.university.edu", "https://idp.vendor.test"] };
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: "https://login.university.edu/saml" }), options), {
    action: "allow", reason: "sign_in",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: "https://idp.vendor.test/oidc/callback" }), options), {
    action: "allow", reason: "sign_in",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: "https://login.university.edu.evil.test/saml" }), options), {
    action: "block", reason: "scan_write",
  });
  assert.throws(() => classifyScanRequest(request(), { signInHosts: ["*.university.edu"] }), /exact HTTP\(S\) host names|Invalid/);
});

test("verified LTI hosts allow launch POSTs and reject ordinary writes", () => {
  const options = { ltiLaunchHosts: ["webassign.example"] };
  const target = "https://webassign.example/lti/launch";
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: target, body: "lti_message_type=LtiResourceLinkRequest&resource_link_id=42" }), options), {
    action: "allow", reason: "lti_launch",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: target, body: "id_token=header.payload.signature&state=abc" }), options), {
    action: "allow", reason: "lti_launch",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: target, body: "answer=42" }), options), {
    action: "block", reason: "scan_write",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: "https://evil.example/lti", body: "id_token=fake" }), options), {
    action: "block", reason: "scan_write",
  });
});

test("Moodle service.php permits only batches made entirely of read-only methods", () => {
  const url = "https://moodle.example/lib/ajax/service.php?sesskey=fixture";
  const readBatch = JSON.stringify([
    { index: 0, methodname: "core_calendar_get_action_events_by_timesort", args: {} },
    { index: 1, methodname: "core_course_get_enrolled_courses_by_timeline_classification", args: {} },
    { index: 2, methodname: "core_course_check_updates", args: {} },
    { index: 3, methodname: "core_session_touch", args: {} },
    { index: 4, methodname: "core_session_time_remaining", args: {} },
  ]);
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url, body: readBatch })), {
    action: "allow", reason: "moodle_read",
  });

  const mixedBatch = JSON.stringify([
    { methodname: "core_calendar_get_calendar_upcoming_view", args: {} },
    { methodname: "mod_assign_save_submission", args: {} },
  ]);
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url, body: mixedBatch })), {
    action: "block", reason: "scan_write",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url, body: "sesskey=fixture" })), {
    action: "block", reason: "scan_write",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "PUT", url, body: readBatch })), {
    action: "block", reason: "scan_write",
  });
  assert.deepEqual(classifyScanRequest(request({ method: "POST", url: "https://moodle.example/other/service.php", body: readBatch })), {
    action: "block", reason: "scan_write",
  });
});

test("guard disposal removes the session listener", () => {
  const webRequest = fakeWebRequest();
  const guard = installScanReadOnlyGuard({ webRequest });
  guard.setScanActive(true);
  guard.dispose();
  guard.dispose();
  assert.equal(webRequest.listener, null);
  assert.doesNotThrow(() => guard.setScanActive(false), "a finishing scan may deactivate after shutdown");
  assert.throws(() => guard.setScanActive(true), /disposed/);
});

function request(overrides = {}) {
  const { body = "", ...details } = overrides;
  return {
    method: "GET",
    url: "https://school.example.edu/course",
    uploadData: body ? [{ bytes: Buffer.from(body) }] : [],
    ...details,
  };
}

function fakeWebRequest() {
  return {
    listener: null,
    onBeforeRequest(filter, listener) {
      if (arguments.length === 1) {
        this.listener = filter;
        return;
      }
      assert.deepEqual(filter, { urls: ["http://*/*", "https://*/*"] });
      this.listener = listener;
    },
    request(overrides) {
      assert.ok(this.listener, "guard listener is installed");
      let response;
      this.listener({
        id: 1,
        referrer: "https://school.example.edu/",
        timestamp: Date.now(),
        ...request(overrides),
      }, value => { response = value; });
      return response;
    },
  };
}
