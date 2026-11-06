import { defineConfig, devices } from "@playwright/test";

// Runs against the built app (npm run build first). Set CHROMIUM_PATH to reuse a browser
// that's already installed; otherwise run `npx playwright install chromium` once.
const executablePath = process.env.CHROMIUM_PATH || undefined;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173/",
    launchOptions: { executablePath, args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true },
});
