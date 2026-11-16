// RR Turbo copy of the unit file (../turboEdu.js): must match make_turbo_files.py in the RIS repo.
const { makeTurboEdu, turboBaseName } = require("../turboEdu");

const EDU = [
  "type             aor caetrati",
  "dictionary       aor_caetrati",
  "recruit_priority_offset -100",
  "",
  "type             roman hastati",
  "dictionary       roman_hastati",
  "recruit_priority_offset -100",
  "",
  "type             merc aor slingers",
  "recruit_priority_offset -100",
  "",
  "type             aor iberian slingers",
  "recruit_priority_offset 30",
  "",
].join("\r\n");

test("AoR units get half recruit priority, nothing else changes", () => {
  const { text, report } = makeTurboEdu(EDU);
  const want = EDU.replace("aor caetrati\r\ndictionary       aor_caetrati\r\nrecruit_priority_offset -100",
                           "aor caetrati\r\ndictionary       aor_caetrati\r\nrecruit_priority_offset -50");
  expect(text).toBe(want);
  expect(report[0].matches).toBe(1);
  expect(report[0].ok).toBe(false);       // 1 is outside the 400-600 a real RIS EDU has
});

test("line endings are kept", () => {
  const lf = EDU.replace(/\r\n/g, "\n");
  expect(makeTurboEdu(lf).text).toBe(makeTurboEdu(EDU).text.replace(/\r\n/g, "\n"));
});

test("only the unit file gets a Turbo copy", () => {
  expect(turboBaseName("export_descr_unit")).toBe("export_descr_unit_turbo");
  expect(turboBaseName(undefined)).toBe("export_descr_unit_turbo");
  expect(turboBaseName("export_descr_unit_light")).toBe(null);
});
