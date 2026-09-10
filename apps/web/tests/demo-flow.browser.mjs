import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
const origin = process.env.DEMO_URL || 'http://127.0.0.1:5173';
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(`${origin}/workspaces`);
  await page.waitForURL('**/login');
  await page.getByText('Welcome back to the mesh.').waitFor();
  assert.match(await page.locator('body').innerText(), /Welcome back to the mesh/);

  await page.goto(`${origin}/signup`);
  await page.getByRole('button', { name: /Continue with a wallet/ }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Connect a browser wallet' }).count(), 1);
  assert.match(await page.getByRole('dialog').innerText(), /MetaMask[\s\S]*Coinbase Wallet[\s\S]*Rabby/);
  await page.screenshot({ path: '/private/tmp/agentmesh-signup-wallet.png', fullPage: true });
  await page.getByLabel('Close wallet dialog').click();
  await page.getByLabel('Display name').fill('Anand');
  await page.getByLabel('Email').fill('anand@agentmesh.demo');
  await page.getByLabel('Password', { exact: true }).fill('demo2026');
  await page.getByLabel('Confirm password').fill('demo2026');
  await page.getByLabel('I accept the local demo terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
  for (const label of ['Connect demo wallet', 'Resolve ENS identity', 'Configure scoped agent', 'Connect coding agent', 'Choose a workspace']) {
    await page.getByRole('button', { name: new RegExp(label) }).click();
  }
  await page.waitForURL('**/workspaces');
  await page.getByRole('button', { name: /Open workspace/ }).first().click();
  await page.waitForURL('**/workspace/checkout-demo');
  await page.waitForSelector('.product-workspace .react-flow__node');

  await page.locator('.app-nav').filter({ hasText: 'Terminal' }).click();
  await page.getByLabel('Terminal command').fill('agentmesh claim AM-114');
  await page.getByLabel('Terminal command').press('Enter');
  await page.waitForTimeout(100);
  assert.match(await page.locator('.product-taskboard').innerText(), /AM-114[\s\S]*claimed/i);

  await page.locator('.app-nav').filter({ hasText: 'Browser' }).click();
  await page.getByRole('button', { name: 'payment-api' }).click();
  assert.match(await page.locator('.demo-browser article').innerText(), /payment-api\.json[\s\S]*Published by Vega/);

  await page.getByLabel('Close browser').click();
  await page.getByRole('button', { name: 'Play guided replay' }).click();
  await page.waitForTimeout(1500);
  assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 1);
  await page.getByRole('button', { name: 'Pause' }).click();
  const step = await page.locator('.demo-toolbar small').innerText();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.demo-toolbar small').innerText(), step);
  await page.screenshot({ path: '/private/tmp/agentmesh-demo-workspace.png', fullPage: true });
  const walletPage = await context.newPage();
  await walletPage.goto(`${origin}/login`);
  await walletPage.getByRole('button', { name: /Continue with a wallet/ }).click();
  await walletPage.getByRole('dialog').getByRole('button', { name: /MetaMask/ }).click();
  await walletPage.getByText('Demo wallet connected').waitFor();
  await walletPage.waitForURL('**/onboarding');
  await walletPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: protected routes, signup, onboarding, workspace, terminal, browser and replay.');
} finally { await browser.close(); }
