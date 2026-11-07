import { test, expect } from "@playwright/test";

const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("./");
});
test.afterEach(() => expect(errors).toEqual([]));

test("the example song renders as letters", async ({ page }) => {
  await page.click("#exampleBtn");
  await expect(page.locator(".measure")).toHaveCount(12);
  await expect(page.locator(".measure").first()).toContainText("C");
  await expect(page.locator("#facts")).toContainText("C major");
});

test("transposing changes the letters in place", async ({ page }) => {
  await page.click("#exampleBtn");
  await page.click("#transUp"); await page.click("#transUp");
  await expect(page.locator(".measure").first().locator(".ev").first()).toContainText("D");
  await expect(page.locator("#facts")).toContainText("D major");
});

test("playback lights up notes and follows speed changes", async ({ page }) => {
  await page.click("#exampleBtn");
  await page.click("#playBtn");
  await expect(page.locator(".ev.on").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#playBtn")).toContainText("Pause");
  await page.fill("#bpm", "200"); await page.press("#bpm", "Enter");
  await expect.poll(() => page.evaluate(() => window.SheetLetters.player.state.playing)).toBe(true);
  await page.click('.mnum[data-mi="8"]');
  await expect(page.locator('.measure.playing[data-mi="8"], .measure.playing[data-mi="9"]')).toHaveCount(1);
  await page.click("#playBtn");
  await expect(page.locator("#playBtn")).toContainText("Play");
});

test("repeats and endings play in order", async ({ page }) => {
  await page.setInputFiles("#fileInput", "tests/fixtures/repeat.musicxml");
  await expect(page.locator("#bpm")).toHaveValue("120");
  const order = await page.evaluate(() => { const s = window.SheetLetters.state.score; return window.SheetLetters.player.playOrder(s.measures).map((i) => s.measures[i].number).join(" "); });
  expect(order).toBe("1 2 3 2 4 5 6");
});

test("a Spotify link offers sheet-music searches", async ({ page }) => {
  await page.route("**/api/spotify*", (r) => r.fulfill({ json: { title: "Let It Be - Remastered 2009", thumbnail: "", kind: "track", id: "7iN1s7xHE4ifF5povM6A48", artists: ["The Beatles"] } }));
  await page.fill("#spotifyUrl", "https://open.spotify.com/track/7iN1s7xHE4ifF5povM6A48?si=x");
  await page.click("#spotifyForm button");
  await expect(page.locator("#spotQuery")).toHaveValue("Let It Be The Beatles");
  await expect(page.locator("#spotFinds a")).toHaveCount(6);
});

test("a YouTube link offers searches and a private player", async ({ page }) => {
  await page.route("**/api/youtube*", (r) => r.fulfill({ json: { title: "Adele - Someone Like You (Official Music Video)", channel: "AdeleVEVO", thumbnail: "", kind: "video", id: "hLQl3WQQoQ0" } }));
  await page.route("**/www.youtube-nocookie.com/**", (r) => r.fulfill({ body: "player", contentType: "text/html" }));
  await page.fill("#spotifyUrl", "https://youtu.be/hLQl3WQQoQ0");
  await page.click("#spotifyForm button");
  await expect(page.locator("#spotQuery")).toHaveValue("Someone Like You Adele");
  await page.click("#spotListen");
  await expect(page.locator("#spotPlayer iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/hLQl3WQQoQ0/);
});

test("note names: Do-Re-Mi and numbers, on screen and in copied text", async ({ page }) => {
  await page.click("#exampleBtn");
  const first = page.locator(".measure").first().locator(".ev .note").first();
  await page.selectOption("#optNames", "fixed");
  await expect(first).toHaveText("Do");
  await page.selectOption("#optNames", "numbers");
  await expect(first).toHaveText("1");
  await page.click("#transUp"); await page.click("#transUp"); // numbers don't change when the key does
  await expect(first).toHaveText("1");
  await page.selectOption("#optNames", "movable");
  await expect(first).toHaveText("Do");
  const text = await page.evaluate(() => window.SheetLetters.toText());
  expect(text).toMatch(/\|\s+Do\s+Do\s+Sol\s+Sol\s/);
  await page.selectOption("#optNames", "letters");
  await expect(first).toHaveText("D");
});

test("printing shows just the song", async ({ page }) => {
  await page.click("#exampleBtn");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".controls")).toBeHidden();
  await expect(page.locator("#player")).toBeHidden();
  await expect(page.locator(".top")).toBeHidden();
  await expect(page.locator("#songTitle")).toBeVisible();
  await expect(page.locator(".measure")).toHaveCount(12);
  await expect(page.locator(".print-credit")).toBeVisible();
});

test("MIDI files open as sheet music, with a pickup bar when the tune starts late", async ({ page }) => {
  await page.setInputFiles("#fileInput", "tests/fixtures/pickup.mid");
  await expect(page.locator("#recPanel")).toBeHidden();
  await expect(page.locator(".measure").first().locator(".mnum")).toHaveText("0");
  await expect(page.locator(".measure").nth(1).locator(".mnum")).toHaveText("1");
});

test("grace notes and triplets are shown and copied", async ({ page }) => {
  await page.setInputFiles("#fileInput", "tests/fixtures/grace-triplets.musicxml");
  await expect(page.locator(".graces")).toHaveCount(2);
  await expect(page.locator(".tup")).toHaveCount(3);
  const text = await page.evaluate(() => window.SheetLetters.toText());
  expect(text).toContain("(D)C");
  expect(text).toContain("3:E");
  await page.click("#playBtn");
  await expect(page.locator(".ev.on").first()).toBeVisible({ timeout: 10_000 });
});

test("song library: pick a song, and the address bar becomes its link", async ({ page }) => {
  await page.selectOption("#libSelect", "ode-to-joy");
  await expect(page.locator("#songTitle")).toHaveText("Ode to Joy");
  await expect(page.locator("#exampleTag")).toHaveText("From the song library");
  await expect(page).toHaveURL(/#song=ode-to-joy$/);
  await page.click("#transUp"); await page.click("#transUp");
  await page.selectOption("#optNames", "fixed");
  await expect(page).toHaveURL(/#song=ode-to-joy&key=2&names=fixed$/);
  await expect(page.locator("#shareBtn")).toBeVisible();
});

test("a shared link opens the song with its key and note names", async ({ page }) => {
  await page.goto("./#song=happy-birthday&key=-2&names=numbers");
  await expect(page.locator("#songTitle")).toHaveText("Happy Birthday to You");
  await expect(page.locator("#facts")).toContainText("B♭ major");
  await expect(page.locator(".measure").first().locator(".note").first()).toHaveText("5");
  await expect(page.locator(".measure").first().locator(".mnum")).toHaveText("0");
});

test("opening your own file drops the song link", async ({ page }) => {
  await page.goto("./#song=ode-to-joy");
  await expect(page.locator("#songTitle")).toHaveText("Ode to Joy");
  await page.setInputFiles("#fileInput", "tests/fixtures/repeat.musicxml");
  await expect(page).not.toHaveURL(/song=/);
  await expect(page.locator("#shareBtn")).toBeHidden();
});

test("melody only keeps the top note of each chord", async ({ page }) => {
  await page.click("#exampleBtn");
  const notes = () => page.locator(".note").count();
  const before = await notes();
  const toggle = async () => { await page.locator("#optMelody").evaluate((el) => el.closest("label").scrollIntoView({ block: "center" })); await page.locator("#optMelody").evaluate((el) => el.click()); };
  await toggle();
  const after = await notes();
  expect(after).toBeLessThan(before);
  const stacked = await page.evaluate(() => window.SheetLetters.state.score.measures.some((m) => Object.values(m.rows).some((evs) => evs.some((e) => e.notes.length > 1))));
  expect(stacked).toBe(false);
  await expect(page.locator(".chord").first()).toBeVisible(); // chord names still from the full song
  await toggle();
  expect(await notes()).toBe(before);
});

test("save as MusicXML and MIDI, in the key shown, and open the saved file again", async ({ page }) => {
  await page.selectOption("#libSelect", "ode-to-joy");
  await expect(page.locator("#songTitle")).toContainText("Ode to Joy");
  await page.click("#transUp"); await page.click("#transUp");
  const [xml] = await Promise.all([page.waitForEvent("download"), page.click("#saveXmlBtn")]);
  expect(xml.suggestedFilename()).toBe("Ode to Joy (in D major).musicxml");
  const text = await (await xml.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(text).toContain("<fifths>2</fifths>");
  const [mid] = await Promise.all([page.waitForEvent("download"), page.click("#saveMidiBtn")]);
  expect(mid.suggestedFilename()).toMatch(/\.mid$/);
  const bytes = await (await mid.createReadStream()).toArray().then((c) => Buffer.concat(c));
  expect(bytes.subarray(0, 4).toString()).toBe("MThd");
  // the saved MusicXML opens with the same first notes
  await page.setInputFiles("#fileInput", { name: "saved.musicxml", mimeType: "application/xml", buffer: Buffer.from(text) });
  await expect(page.locator("#facts")).toContainText("D major");
  await expect(page.locator(".measure").first().locator(".ev").first()).toContainText(/F[#♯]/);
});

test("fix notes: tap a note, change it, undo, and save the change", async ({ page }) => {
  await page.selectOption("#libSelect", "mary-had-a-little-lamb");
  await expect(page.locator("#songTitle")).toContainText("Mary");
  await page.click("#editBtn");
  await expect(page.locator("#editBar")).toBeVisible();
  const first = page.locator('.measure[data-mi="0"] .ev[data-i="0"]');
  await first.click();
  await expect(first).toHaveClass(/sel/);
  await expect(page.locator("#editWhat")).toContainText("E4");
  await expect(page.locator("#editWhat")).toContainText("quarter note");
  await page.click("#edHigher");
  await expect(page.locator('.measure[data-mi="0"] .ev[data-i="0"]')).toContainText("F");
  await expect(page.locator("#facts")).toContainText("changed some notes");
  // the library link is dropped: it wouldn't include the change
  expect(page.url()).not.toContain("song=");
  // keyboard: up a semitone, then undo it
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('.measure[data-mi="0"] .ev[data-i="0"]')).toContainText(/F[#♯]/);
  await page.keyboard.press("Control+z");
  await expect(page.locator('.measure[data-mi="0"] .ev[data-i="0"] .note').first()).toHaveText("F");
  // next note with →, then delete it: a rest takes its place
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#editWhat")).toContainText("D4");
  await page.click("#edDelete");
  await expect(page.locator('.measure[data-mi="0"] .ev')).toHaveCount(4);
  // the change comes along when transposed and when saved
  await page.click("#transUp"); await page.click("#transUp");
  await expect(page.locator('.measure[data-mi="0"] .ev[data-i="0"]')).toContainText("G");
  const [xml] = await Promise.all([page.waitForEvent("download"), page.click("#saveXmlBtn")]);
  const text = await (await xml.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  expect(text).toMatch(/<step>G<\/step><octave>4<\/octave>/);
  await page.click("#edDone");
  await expect(page.locator("#editBar")).toBeHidden();
  await expect(page.locator(".ev.sel")).toHaveCount(0);
});

test("fix notes: select several and move them together", async ({ page }) => {
  await page.selectOption("#libSelect", "mary-had-a-little-lamb");
  await page.click("#editBtn");
  const ev = (mi, i) => page.locator(`.measure[data-mi="${mi}"] .ev[data-i="${i}"]`);
  await ev(0, 2).click();
  await page.click("#edMany");
  await expect(page.locator("#editWhat")).toContainText("tap the last note");
  await ev(1, 1).click();
  await expect(page.locator("#editWhat")).toContainText("4 notes");
  await expect(page.locator("#editWhat")).toContainText("bars 1–2");
  await expect(page.locator(".ev.sel")).toHaveCount(4);
  await expect(page.locator("#edShorter")).toBeDisabled();
  await page.click("#edHigher"); await page.click("#edHigher");
  await expect(ev(0, 2)).toContainText("D");
  await expect(ev(1, 1)).toContainText(/F[#♯]/);
  await expect(ev(0, 0)).toContainText("E"); // outside the selection: unchanged
  await expect(page.locator(".ev.sel")).toHaveCount(4);
  // Shift+→ adds the next note; Esc goes back to one note; undo twice restores the tune
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator("#editWhat")).toContainText("5 notes");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ev.sel")).toHaveCount(1);
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z");
  await expect(ev(0, 2).locator(".note").first()).toHaveText("C");
  // Shift+click works too, and the whole run can be deleted
  await ev(2, 0).click();
  await ev(2, 2).click({ modifiers: ["Shift"] });
  await expect(page.locator("#editWhat")).toContainText("3 notes");
  await page.click("#edDelete");
  await expect(page.locator('.measure[data-mi="2"] .ev[data-i]')).toHaveCount(0);
});
