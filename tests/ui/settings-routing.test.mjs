import assert from "node:assert/strict";
import test from "node:test";
import { SETTINGS_SECTIONS, settingsTab } from "../../desktop/src/app/settingsRouting.ts";
test("Settings deep links select one of exactly five tabs", () => {
  assert.deepEqual(SETTINGS_SECTIONS.map(item=>item.id),["inky","homework","school","notifications","you"]);
  assert.equal(settingsTab("settings"),"inky");
  assert.equal(settingsTab("usage"),"you"); assert.equal(settingsTab("feedback"),"you");
  assert.equal(settingsTab("rules"),"homework");
  for(const {id} of SETTINGS_SECTIONS) assert.equal(settingsTab("settings",id),id);
  assert.equal(settingsTab("usage","school"),"you");
});

