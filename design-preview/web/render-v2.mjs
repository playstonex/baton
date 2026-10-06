import { chromium } from '/Users/lei/.nvm/versions/node/v26.2.0/lib/node_modules/@playwright/test/index.mjs';

const ROOT = '/Volumes/Hi/lei/Projects/FlowWhips/design-preview/web';

const jobs = [
  {
    file: 'dashboard-v2.html',
    frames: [
      ['f1', 'dashboard-v2-dark.png'],
      ['f2', 'dashboard-v2-light.png'],
      ['f3', 'dashboard-v2-dialog.png'],
      ['f4', 'dashboard-v2-empty-light.png'],
      ['f5', 'dashboard-v2-offline.png'],
    ],
  },
  {
    file: 'settings-v2.html',
    frames: [
      ['s1', 'settings-v2-local-light.png'],
      ['s2', 'settings-v2-remote-dark.png'],
    ],
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1620, height: 1400 },
  deviceScaleFactor: 2,
});

for (const job of jobs) {
  await page.goto(`file://${ROOT}/${job.file}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  for (const [id, out] of job.frames) {
    await page.locator(`#${id}`).screenshot({ path: `${ROOT}/${out}` });
    console.log('✓', out);
  }
}

await browser.close();
