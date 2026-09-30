import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NOTIFICATION_PREFERENCES, NotificationPreferencesSchema, isQuietHours, resolveNotificationSound, shouldShowNotificationBanner } from "../../dist/shared/product.js";
const time = (hour, minute = 0) => new Date(2026, 8, 23, hour, minute);
test("quiet hours migrate off, validate wall times and suppress both banner and sound", () => {
  const { quietHours, ...legacy } = DEFAULT_NOTIFICATION_PREFERENCES;
  assert.equal(NotificationPreferencesSchema.parse(legacy).quietHours, "off");
  assert.equal(isQuietHours("off", time(23)), false);
  for (const hours of [{ start:"25:00", end:"08:00" }, { start:"22:00", end:"22:00" }])
    assert.equal(NotificationPreferencesSchema.safeParse({ ...legacy, quietHours:hours }).success, false);
  const preferences = NotificationPreferencesSchema.parse({ ...legacy, quietHours:{ start:"22:00", end:"08:00" } });
  for (const [hour, minute, quiet] of [[21,59,false],[22,0,true],[23,59,true],[0,0,true],[7,59,true],[8,0,false]]) {
    assert.equal(isQuietHours(preferences.quietHours, time(hour,minute)), quiet);
    assert.equal(shouldShowNotificationBanner(preferences,"handoff",time(hour,minute)), !quiet);
    assert.deepEqual(resolveNotificationSound(preferences,"handoff",()=>true,time(hour,minute)), { silent:true, playSoundId:quiet?null:"inky_nudge" });
    assert.deepEqual(resolveNotificationSound(preferences,"handoff",()=>false,time(hour,minute)), { silent:quiet, playSoundId:null });
  }
});
test("daytime quiet window includes start and excludes end", () => {
  const hours = { start:"09:00", end:"11:30" };
  for (const [hour,minute,expected] of [[8,59,false],[9,0,true],[11,29,true],[11,30,false],[23,0,false]]) assert.equal(isQuietHours(hours,time(hour,minute)),expected);
});
