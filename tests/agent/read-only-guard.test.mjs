import assert from "node:assert/strict";
import test from "node:test";

import {
  autofillLtiLaunchHost,
  autofillSignInHosts,
  classifyScanRequest,
  installScanReadOnlyGuard,
} from "../../dist/electron/browser/read-only-guard.js";
import { SchoolProfileSchema } from "../../dist/shared/school-scan.js";

test("school profiles default both exact-host allowlists", () => {
  const profile = SchoolProfileSchema.parse({
    schemaVersion: 1,
    profileId: "primary-school",
    studentName: "Student",
    schoolRoot: "https://school.example.edu",
    defaultPermission: "attempt",
    scanCadence: "daily",
    onboardingState: "profile_saved",
    missedCourseFeedback: [],
    updatedAt: "2026-09-24T12:00:00.000Z",
  });

  assert.deepEqual({
    signInHosts: profile.signInHosts,
    ltiLaunchHosts: profile.ltiLaunchHosts,
  }, { signInHosts: [], ltiLaunchHosts: [] });
  const normalized = SchoolProfileSchema.parse({
    ...profile,
    signInHosts: ["LOGIN.University.edu", "https://login.university.edu/"],
    ltiLaunchHosts: ["tools.vendor.test:8443"],
  });
  assert.deepEqual({
    signInHosts: normalized.signInHosts,
    ltiLaunchHosts: normalized.ltiLaunchHosts,
  }, {
    signInHosts: ["login.university.edu"],
    ltiLaunchHosts: ["tools.vendor.test:8443"],
  });
  assert.throws(() => SchoolProfileSchema.parse({
    ...profile,
    signInHosts: ["*.university.edu"],
  }), /exact HTTP\(S\) host names/);
});

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
  assert.throws(() => classifyScanRequest(request(), { signInHosts: ["*.university.edu"] }), /exact HTTP\(S\) host names/);
});

test("sign-in hosts autofill only after a school-to-IdP-to-school handoff succeeds", () => {
  const learned = autofillSignInHosts(undefined, {
    schoolRoot: "https://school.example.edu/",
    redirectChain: [
      "https://school.example.edu/login?return=%2Fcourses",
      "https://login.university.edu/saml?request=opaque-secret",
      "https://duo.vendor.test/prompt?state=another-secret",
      "https://school.example.edu/sso/callback?code=one-time-secret",
    ],
    context: "onboarding",
    signedIn: true,
  });

  assert.deepEqual(learned, {
    signInHosts: ["login.university.edu", "duo.vendor.test"],
    ltiLaunchHosts: [],
  });
  assert.doesNotMatch(JSON.stringify(learned), /opaque-secret|another-secret|one-time-secret/);
  assert.throws(() => autofillSignInHosts(undefined, {
    schoolRoot: "https://school.example.edu/",
    redirectChain: [
      "https://school.example.edu/login",
      "https://login.university.edu/saml",
      "https://school.example.edu/home",
    ],
    context: "needs_you",
    signedIn: false,
  }), /verified signed-in/);
  assert.throws(() => autofillSignInHosts(undefined, {
    schoolRoot: "https://school.example.edu/",
    redirectChain: [
      "https://untrusted.example/start",
      "https://login.university.edu/saml",
      "https://school.example.edu/home",
    ],
    context: "needs_you",
    signedIn: true,
  }), /from the school root/);
  assert.throws(() => autofillSignInHosts(undefined, {
    schoolRoot: "https://school.example.edu/",
    redirectChain: [
      "https://school.example.edu/login",
      "https://login.university.edu/saml",
      "https://evil.example/callback",
    ],
    context: "needs_you",
    signedIn: true,
  }), /same school host/);
});

test("LTI hosts autofill only from launch form actions on verified course pages", () => {
  const pageUrl = "https://school.example.edu/course/view.php?id=217";
  const learned = autofillLtiLaunchHost(undefined, {
    pageUrl,
    action: "https://webassign.example/lti/launch?opaque=not-persisted",
    method: "post",
    fieldNames: ["lti_message_type", "resource_link_id", "oauth_consumer_key"],
  }, [pageUrl]);

  assert.deepEqual(learned, { signInHosts: [], ltiLaunchHosts: ["webassign.example"] });
  assert.doesNotMatch(JSON.stringify(learned), /launch|opaque/);
  assert.throws(() => autofillLtiLaunchHost(undefined, {
    pageUrl: "https://school.example.edu/dashboard",
    action: "https://random-post.example/submit",
    method: "POST",
    fieldNames: ["lti_message_type", "resource_link_id"],
  }, [pageUrl]), /verified course page/);
  assert.throws(() => autofillLtiLaunchHost(undefined, {
    pageUrl,
    action: "https://random-post.example/submit",
    method: "POST",
    fieldNames: ["answer", "submit"],
  }, [pageUrl]), /not an LTI launch form/);
  assert.throws(() => autofillLtiLaunchHost(undefined, {
    pageUrl,
    action: "https://student:password@webassign.example/lti/launch",
    method: "POST",
    fieldNames: ["id_token", "state"],
  }, [pageUrl]), /credential-free/);
});

test("learned hosts accumulate without replacing the other allowlist", () => {
  const afterSignIn = autofillSignInHosts({
    signInHosts: ["existing-idp.example"],
    ltiLaunchHosts: ["existing-tool.example"],
  }, {
    schoolRoot: "https://school.example.edu/",
    redirectChain: [
      "https://school.example.edu/login",
      "https://NEW-IDP.example/saml",
      "https://school.example.edu/home",
    ],
    context: "needs_you",
    signedIn: true,
  });
  const learned = autofillLtiLaunchHost(afterSignIn, {
    pageUrl: "https://school.example.edu/course/230",
    action: "/mod/lti/launch.php?id=7",
    method: "POST",
    fieldNames: ["id_token", "state"],
  }, ["https://school.example.edu/course/230"]);

  assert.deepEqual(learned, {
    signInHosts: ["existing-idp.example", "new-idp.example"],
    ltiLaunchHosts: ["existing-tool.example", "school.example.edu"],
  });
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

test("installed guard replaces its saved policy without opening random POST hosts", () => {
  const webRequest = fakeWebRequest();
  const guard = installScanReadOnlyGuard({ webRequest });
  guard.setScanActive(true);
  guard.setAllowedHosts({
    signInHosts: ["login.university.edu"],
    ltiLaunchHosts: ["webassign.example"],
  });

  assert.deepEqual(webRequest.request({ method: "POST", url: "https://login.university.edu/saml" }), {});
  assert.deepEqual(webRequest.request({
    method: "POST",
    url: "https://webassign.example/lti/launch",
    body: "id_token=header.payload.signature&state=opaque",
  }), {});
  assert.deepEqual(webRequest.request({
    method: "POST",
    url: "https://random-post.example/submit",
    body: "id_token=fake&state=fake",
  }), { cancel: true });
  assert.deepEqual(webRequest.request({
    method: "POST",
    url: "https://webassign.example/answers",
    body: "answer=42",
  }), { cancel: true });
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
