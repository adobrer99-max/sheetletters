import { test, expect } from "@playwright/test";

// A solo recording skips song splitting (which needs a 172 MB model), so it runs in CI.
// Ode to Joy, sung-style, 100 BPM: the first 12 notes.
test("a solo recording becomes letters on the beat", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("./");
  await page.setInputFiles("#fileInput", "tests/fixtures/ode-voice-8s.wav");
  await expect(page.locator("#recBy")).toContainText("a recording"); // the panel has read the file
  await page.locator('input[name="recPart"][value="solo"]').evaluate((el) => el.click()); // the radio is styled as a chip
  await expect(page.locator('input[name="recPart"][value="solo"]')).toBeChecked();
  await page.click("#recGo");
  await expect(page.locator("#recDone")).toBeVisible({ timeout: 200_000 });
  const letters = await page.evaluate(() => {
    const s = window.SheetLetters.state.score;
    return s.measures.flatMap((m) => (m.rows[s.rows[0].id] || []).filter((e) => !e.rest).map((e) => e.notes[0].step));
  });
  expect(letters.slice(0, 12).join(" ")).toBe("E E F G G F E D C C D E");
  await expect(page.locator("#bpm")).toHaveValue(/^(99|100|101)$/);
});

test("play the recording itself, with the letters following it", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("./");
  await page.setInputFiles("#fileInput", "tests/fixtures/ode-voice-8s.wav");
  await expect(page.locator("#recBy")).toContainText("a recording"); // the panel has read the file
  await page.locator('input[name="recPart"][value="solo"]').evaluate((el) => el.click()); // the radio is styled as a chip
  await expect(page.locator('input[name="recPart"][value="solo"]')).toBeChecked();
  await page.click("#recGo");
  await expect(page.locator("#recDone")).toBeVisible({ timeout: 200_000 });
  // a solo recording: Piano or the recording (no separate part to offer)
  await expect(page.locator("#soundSel")).toBeVisible();
  await expect(page.locator("#soundSel option")).toHaveText(["Piano", "The recording"]);
  await expect(page.locator("#soundSel")).toHaveValue("mix");
  await page.click("#playBtn");
  await expect(page.locator(".measure.playing")).toHaveCount(1);
  // the highlighted measure is the one the recording is at
  await page.waitForTimeout(2500);
  const check = await page.evaluate(() => {
    const { player } = window.SheetLetters, P = player.state;
    const t = player.media.currentTime;
    const mi = +document.querySelector(".measure.playing").dataset.mi;
    return { t, playing: !player.media.paused, rate: player.media.playbackRate, mi, start: P.starts[mi], len: window.SheetLetters.state.score.measures[mi].len, q: P.pos.local + P.starts[mi] };
  });
  expect(check.playing).toBe(true);
  expect(check.t).toBeGreaterThan(1.5);
  expect(check.rate).toBeCloseTo(1, 1);
  // at 100 BPM, 2.5 s in is about beat 4: bar 1 or 2 depending on the pickup
  expect(check.q).toBeGreaterThan(2);
  expect(check.q).toBeLessThan(7);
  // slower: the recording slows down without stopping
  await page.click("#bpmDown"); await page.click("#bpmDown"); await page.click("#bpmDown");
  expect(await page.evaluate(() => window.SheetLetters.player.media.playbackRate)).toBeLessThan(0.95);
  expect(await page.evaluate(() => window.SheetLetters.player.media.paused)).toBe(false);
  // start from bar 3: the recording jumps to where bar 3 is sung
  await page.locator('.mnum[data-mi="3"]').click();
  await expect(page.locator('.measure[data-mi="3"]')).toHaveClass(/playing/);
  const jump = await page.evaluate(() => {
    const { player } = window.SheetLetters, P = player.state;
    return { t: player.media.currentTime, bar: P.rec.sync.beats[0] };
  });
  expect(jump.t).toBeGreaterThan(3); // bar 3 is at least 7 beats in, at 100 BPM
  // pause, then switch to the piano
  await page.click("#playBtn");
  expect(await page.evaluate(() => window.SheetLetters.player.media.paused)).toBe(true);
  await page.selectOption("#soundSel", "piano");
  await page.click("#playBtn");
  await expect(page.locator(".measure.playing")).toHaveCount(1);
  expect(await page.evaluate(() => window.SheetLetters.player.media.paused)).toBe(true);
  await page.click("#playBtn");
});
