import assert from "node:assert/strict";
import test from "node:test";
import { scanNativeFormControls, validateFormControlGuard } from "./form-control-guard.js";

test("form control guard rejects direct native controls", () => {
  assert.deepEqual(scanNativeFormControls("<select><option>one</option></select>", "fixture.jsx"), ["fixture.jsx: disallowed native <select>"]);
  assert.deepEqual(scanNativeFormControls("<input type=\"checkbox\" />", "fixture.jsx"), ["fixture.jsx: disallowed native <input>"]);
  assert.deepEqual(scanNativeFormControls("<textarea />", "fixture.jsx"), ["fixture.jsx: disallowed native <textarea>"]);
});

test("form control guard permits documented native fallbacks only", () => {
  const allowed = "/* native-control-exception: browser file picker needs a hidden input */\n<input type=\"file\" hidden data-native-control-exception />\n/* native-control-exception: browser color picker */\n<input type=\"color\" data-native-control-exception />";
  assert.deepEqual(scanNativeFormControls(allowed, "fixture.jsx"), []);
  assert.equal(scanNativeFormControls("<input type=\"file\" data-native-control-exception />", "fixture.jsx").length, 1);
});

test("collection and template-library sources pass the form control guard", () => {
  assert.doesNotThrow(() => validateFormControlGuard());
});
