import { test, expect } from "@playwright/test";

// A solo recording skips song splitting (which needs a 172 MB model), so it runs in CI.
// Ode to Joy, sung-style, 100 BPM: the first 12 notes.
test("a solo recording becomes letters on the beat", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("./");
  await page.setInputFiles("#fileInput", "tests/fixtures/ode-voice-8s.wav");
  await expect(page.locator("#recPanel")).toBeVisible();
  await page.check('input[name="recPart"][value="solo"]', { force: true });
  await page.click("#recGo");
  await expect(page.locator("#recDone")).toBeVisible({ timeout: 200_000 });
  const letters = await page.evaluate(() => {
    const s = window.SheetLetters.state.score;
    return s.measures.flatMap((m) => (m.rows[s.rows[0].id] || []).filter((e) => !e.rest).map((e) => e.notes[0].step));
  });
  expect(letters.slice(0, 12).join(" ")).toBe("E E F G G F E D C C D E");
  await expect(page.locator("#bpm")).toHaveValue(/^(99|100|101)$/);
});
