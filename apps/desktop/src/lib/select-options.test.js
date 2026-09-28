import assert from "node:assert/strict";
import test from "node:test";
import { resolveSelectItems, SELECT_LOADING_LABEL, SELECT_UNAVAILABLE_LABEL } from "./select-options.js";
import { scanSelectRoots, validateSelectItemsGuard } from "./select-items-guard.js";

test("Root items retain the full unfiltered option labels", () => {
  const options = [
    { value: "person-1", label: "林晓" },
    { value: "person-2", label: "陈安" },
  ];
  const filteredPopupOptions = options.filter((option) => option.label.includes("林"));
  const result = resolveSelectItems(options, { value: "person-2" });

  assert.deepEqual(filteredPopupOptions.map((option) => option.value), ["person-1"]);
  assert.deepEqual(result.items, options);
  assert.equal(result.missingOption, null);
});

test("an unresolved value remains selected while async options are loading", () => {
  const result = resolveSelectItems([], { value: "member-42", loading: true });
  assert.equal(result.items[0].value, "member-42");
  assert.equal(result.items[0].label, SELECT_LOADING_LABEL);
  assert.equal(result.items[0].disabled, true);
  assert.equal(result.missingOption, result.items[0]);
});

test("a cached selected label survives loading without being marked unavailable", () => {
  const result = resolveSelectItems([], { value: "member-42", loading: true, selectedLabel: "周宁" });
  assert.equal(result.missingOption.label, "周宁");
});

test("a missing loaded option is retained as a disabled stale choice", () => {
  const result = resolveSelectItems([], { value: "member-42", selectedLabel: "周宁" });
  assert.equal(result.missingOption.value, "member-42");
  assert.equal(result.missingOption.label, "周宁（已停用）");
  assert.equal(result.missingOption.disabled, true);
});

test("an unknown stale value never falls back to its raw identifier", () => {
  const result = resolveSelectItems([], { value: "private-id-42" });
  assert.equal(result.missingOption.label, SELECT_UNAVAILABLE_LABEL);
  assert.notEqual(result.missingOption.label, "private-id-42");
});

test("static guard requires items on Select roots, not merely on popup items", () => {
  assert.deepEqual(scanSelectRoots('<Select value={id}><SelectItem value="x">X</SelectItem></Select>', "bad.jsx"), [
    "bad.jsx:1 Select.Root requires an explicit items mapping",
  ]);
  assert.deepEqual(scanSelectRoots('<Select items={options} value={id}><SelectContent /></Select>', "good.jsx"), []);
  assert.deepEqual(scanSelectRoots('<Select\n items={build(items, value)}\n value={value} />', "good.jsx"), []);
});

test("all business Select roots declare items mappings", () => {
  assert.doesNotThrow(() => validateSelectItemsGuard());
});
