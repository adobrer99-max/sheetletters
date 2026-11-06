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
