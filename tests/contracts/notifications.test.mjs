import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesSchema,
  resolveNotificationSound,
  shouldShowNotificationBanner,
} from "../../dist/shared/index.js";

test("notification defaults keep every kind on with reserved Inky slots", () => {
  const preferences = NotificationPreferencesSchema.parse(DEFAULT_NOTIFICATION_PREFERENCES);
  assert.equal(preferences.enabled, true);
  assert.equal(preferences.kinds.handoff.sound, "inky_nudge");
  assert.equal(preferences.kinds.review_ready.sound, "inky_done");
  assert.equal(preferences.kinds.scan_result.sound, "inky_soft");
  assert.equal(preferences.kinds.failure.sound, "inky_uh_oh");
  for (const kind of ["handoff", "review_ready", "scan_result", "failure"]) {
    assert.equal(shouldShowNotificationBanner(preferences, kind), true);
  }
});

test("banner and sound resolver honor mute, silent, OS, and missing Inky files", () => {
  const muted = NotificationPreferencesSchema.parse({
    enabled: false,
    kinds: DEFAULT_NOTIFICATION_PREFERENCES.kinds,
  });
  assert.equal(shouldShowNotificationBanner(muted, "handoff"), false);

  const kindOff = NotificationPreferencesSchema.parse({
    enabled: true,
    kinds: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.kinds,
      review_ready: { banner: false, sound: "os" },
    },
  });
  assert.equal(shouldShowNotificationBanner(kindOff, "review_ready"), false);
  assert.equal(shouldShowNotificationBanner(kindOff, "handoff"), true);

  const silent = NotificationPreferencesSchema.parse({
    enabled: true,
    kinds: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.kinds,
      failure: { banner: true, sound: "silent" },
    },
  });
  assert.deepEqual(resolveNotificationSound(silent, "failure", () => true), {
    silent: true,
    playSoundId: null,
  });

  assert.deepEqual(resolveNotificationSound(DEFAULT_NOTIFICATION_PREFERENCES, "handoff", () => false), {
    silent: false,
    playSoundId: null,
  });
  assert.deepEqual(resolveNotificationSound(DEFAULT_NOTIFICATION_PREFERENCES, "handoff", (id) => id === "inky_nudge"), {
    silent: true,
    playSoundId: "inky_nudge",
  });
});
