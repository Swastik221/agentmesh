import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(process.env.WORKSPACE_URL || 'http://127.0.0.1:5173/canvas');
  await page.waitForSelector('.product-workspace .react-flow__node');
  assert.equal(await page.locator('.product-workspace .react-flow__node').count(), 6);
  assert.equal(await page.locator('.product-presence').count(), 2);
  assert.equal(await page.locator('.workspace-inspector-panel').count(), 0);
  assert.equal(await page.locator('.protocol-rail').count(), 0);
  assert.match(
    await page
      .locator('.product-canvas')
      .evaluate((element) => getComputedStyle(element).backgroundImage),
    /rgb\(18, 63, 91\)/,
  );
  assert.match(
    await page
      .locator('.product-coordinator')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    /203, 244, 122/,
  );
  assert.match(
    await page
      .locator('.product-artifact')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    /40, 31, 61/,
  );
  assert.equal(await page.locator('.canvas-legend span').count(), 3);
  assert.equal(await page.locator('.product-minimap').count(), 1);
  assert.match(await page.locator('.product-presence--purple').innerText(), /Anand-demo/);
  assert.match(await page.locator('.product-presence--green').innerText(), /Swastik-demo/);
  await page.screenshot({ path: '/private/tmp/agentmesh-product-workspace-default.png' });

  await page
    .locator('.canvas-context__tools')
    .getByRole('button', { name: /^Activity/ })
    .click();
  await page.locator('.canvas-context__tools').getByRole('button', { name: 'Inspector' }).click();
  await page.waitForTimeout(450);
  assert.equal(await page.locator('.protocol-events article').count(), 7);
  assert.match(await page.locator('.workspace-inspector-panel').innerText(), /Orion \/ Codex/);
  assert.match(
    await page.locator('.workspace-inspector-panel').innerText(),
    /Cannot access wallet keys/,
  );

  const countdown = Number(
    (await page.locator('.product-taskboard time').first().innerText()).match(/\d+/)[0],
  );
  await page.waitForTimeout(1100);
  assert.ok(
    Number((await page.locator('.product-taskboard time').first().innerText()).match(/\d+/)[0]) <
      countdown,
  );

  await page.getByRole('button', { name: 'Claim task' }).first().click();
  await page.waitForTimeout(100);
  assert.match(await page.locator('.product-taskboard').innerText(), /AM-114[\s\S]*claimed/i);
  assert.match(await page.locator('.protocol-events article').last().innerText(), /TASK_CLAIMED/);
  assert.match(
    await page.locator('.react-flow__edge[data-id="tasks-orion"]').textContent(),
    /claimed: AM-114/,
  );
  assert.match(await page.locator('.react-flow__node[data-id="orion"]').innerText(), /connected/i);
  assert.match(await page.locator('.inspector-events').innerText(), /APPROVAL_REQUESTED/);

  await page.locator('.react-flow__node[data-id="vega"]').click();
  assert.match(await page.locator('.workspace-inspector-panel').innerText(), /claude\.dev2\.eth/);
  const orion = page.locator('.react-flow__node[data-id="orion"]');
  const before = await orion.boundingBox();
  const edge = page.locator('.react-flow__edge[data-id="tasks-orion"]');
  const edgeBefore = await edge.locator('path').first().getAttribute('d');
  await page.mouse.move(before.x + 100, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 155, before.y + 55, { steps: 8 });
  assert.match(await page.locator('.product-presence--purple').innerText(), /is moving Orion/);
  await page.mouse.up();
  const after = await orion.boundingBox();
  assert.ok(after.x > before.x + 25 && after.y > before.y + 15);
  const edgeAfter = await edge.locator('path').first().getAttribute('d');
  assert.notEqual(edgeBefore, edgeAfter);

  await page.getByRole('button', { name: 'Reject' }).click();
  assert.match(await page.locator('.product-approval').innerText(), /Rejected by dev1\.eth/);
  assert.match(
    await page.locator('.protocol-events article').last().innerText(),
    /APPROVAL_REJECTED/,
  );
  assert.match(
    await page.locator('.react-flow__edge[data-id="vega-approval"]').textContent(),
    /deploy rejected/,
  );
  await page.screenshot({ path: '/private/tmp/agentmesh-product-workspace.png', fullPage: true });

  await page.getByRole('button', { name: 'Replay demo' }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('button', { name: 'Reject' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Claim task' }).count(), 3);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: product canvas layout, countdown, claim, inspector, drag, edges, approval and replay.',
  );
} finally {
  await browser.close();
}
