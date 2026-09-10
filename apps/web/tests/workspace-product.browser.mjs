import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(process.env.WORKSPACE_URL || 'http://127.0.0.1:5173/canvas');
  await page.waitForSelector('.product-workspace .react-flow__node');
  assert.equal(await page.locator('.product-workspace .react-flow__node').count(), 6);
  assert.equal(await page.locator('.product-presence').count(), 0);
  assert.equal(await page.locator('.workspace-inspector-panel').count(), 0);
  assert.equal(await page.locator('.protocol-rail').count(), 0);
  assert.equal(
    await page
      .locator('.product-canvas')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(7, 16, 30)',
  );
  assert.equal(
    await page
      .locator('.product-coordinator')
      .evaluate((element) => getComputedStyle(element).borderColor),
    'rgba(56, 199, 229, 0.76)',
  );
  assert.equal(
    await page
      .locator('.product-artifact')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(47, 37, 79)',
  );
  assert.equal(
    await page
      .locator('.canvas-owner-green .product-agent')
      .evaluate((element) => getComputedStyle(element).borderColor),
    'rgba(47, 209, 188, 0.78)',
  );
  assert.equal(
    await page
      .locator('.product-node header strong')
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize),
    '15px',
  );
  assert.equal(await page.locator('.canvas-legend span').count(), 3);
  assert.equal(await page.locator('.product-minimap').count(), 1);

  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  assert.match(await page.locator('.workspace-view').innerText(), /Connected agents/);
  assert.equal(await page.locator('.agent-directory__card').count(), 2);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  assert.equal(await page.locator('.task-table article').count(), 4);
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  assert.match(await page.locator('.artifact-preview').innerText(), /payment-api\.json/);
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  assert.match(await page.locator('.activity-stream').innerText(), /TASK_PROPOSAL/);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.waitForSelector('.product-workspace .react-flow__node');

  // The rail now opens from its collapsed icon state rather than the other way
  // round: it starts as a 46px strip, matching the reference chrome.
  const collapsedSidebar = await page.locator('.app-sidebar').boundingBox();
  assert.equal(await page.locator('.app-nav__label').first().isVisible(), false);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.waitForTimeout(260);
  const expandedSidebar = await page.locator('.app-sidebar').boundingBox();
  assert.ok(expandedSidebar && collapsedSidebar && collapsedSidebar.width < expandedSidebar.width);
  assert.equal(await page.locator('.app-nav__label').first().isVisible(), true);
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.waitForTimeout(260);

  await page.getByRole('button', { name: 'Focus view' }).click();
  // The shell always names its rail state now, so the class list is matched
  // rather than compared whole.
  assert.match(await page.locator('.app-shell').getAttribute('class'), /is-focus-view/);
  assert.equal(await page.locator('.app-header').isVisible(), false);
  assert.equal(await page.locator('.app-sidebar').isVisible(), false);
  assert.equal(await page.locator('.app-status').isVisible(), false);
  await page.keyboard.press('Escape');
  assert.doesNotMatch(await page.locator('.app-shell').getAttribute('class'), /is-focus-view/);

  const collaborator = await page.context().newPage();
  await collaborator.goto(process.env.WORKSPACE_URL || 'http://127.0.0.1:5173/canvas');
  await collaborator.waitForSelector('.product-workspace .react-flow__node');
  const collaboratorCanvas = await collaborator.locator('.product-canvas').boundingBox();
  await collaborator.mouse.move(
    collaboratorCanvas.x + collaboratorCanvas.width * 0.66,
    collaboratorCanvas.y + collaboratorCanvas.height * 0.42,
  );
  await page.locator('.live-collaborator-cursor').waitFor();
  assert.match(await page.locator('.live-collaborator-cursor').innerText(), /dev1\.eth/);
  await collaborator.close();
  await page.locator('.live-collaborator-cursor').waitFor({ state: 'detached' });
  await page.screenshot({ path: '/private/tmp/agentmesh-product-workspace-default.png' });

  await page
    .locator('.canvas-context__tools')
    .getByRole('button', { name: /^Activity/ })
    .click();
  await page.locator('.canvas-context__tools').getByRole('button', { name: 'Inspector' }).click();
  await page.waitForTimeout(450);
  const canvasBox = await page.locator('.product-canvas').boundingBox();
  const inspectorBox = await page.locator('.workspace-inspector-panel').boundingBox();
  const activityBox = await page.locator('.protocol-rail').boundingBox();
  assert.ok(canvasBox && inspectorBox && activityBox);
  assert.ok(inspectorBox.x >= canvasBox.x + canvasBox.width - 1);
  assert.ok(activityBox.y >= canvasBox.y + canvasBox.height - 1);
  assert.ok(activityBox.x + activityBox.width <= inspectorBox.x + 1);
  assert.equal(await page.locator('.protocol-events article').count(), 7);
  assert.match(await page.locator('.workspace-inspector-panel').innerText(), /Orion \/ Codex/);
  assert.match(
    await page.locator('.workspace-inspector-panel').innerText(),
    /Cannot access wallet keys/,
  );

  await page.locator('.app-status').getByRole('button', { name: 'Terminal' }).click();
  await page.waitForTimeout(320);
  const terminalBox = await page.locator('.demo-terminal').boundingBox();
  const adjustedActivityBox = await page.locator('.protocol-rail').boundingBox();
  const adjustedInspectorBox = await page.locator('.workspace-inspector-panel').boundingBox();
  assert.ok(terminalBox && adjustedActivityBox && adjustedInspectorBox);
  assert.ok(terminalBox.y >= adjustedActivityBox.y + adjustedActivityBox.height - 1);
  assert.ok(terminalBox.y >= adjustedInspectorBox.y + adjustedInspectorBox.height - 1);
  await page.locator('.app-status').getByRole('button', { name: 'Terminal' }).click();

  await page.locator('.app-status').getByRole('button', { name: 'Browser' }).click();
  await page.waitForTimeout(320);
  const browserBox = await page.locator('.demo-browser').boundingBox();
  assert.ok(browserBox && browserBox.y >= adjustedActivityBox.y + adjustedActivityBox.height - 1);
  await page.locator('.app-status').getByRole('button', { name: 'Browser' }).click();

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
  assert.match(await page.locator('.canvas-move-status').innerText(), /Moving Orion/);
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

  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForTimeout(320);
  const compactCanvas = await page.locator('.product-canvas').boundingBox();
  const compactInspector = await page.locator('.workspace-inspector-panel').boundingBox();
  const compactActivity = await page.locator('.protocol-rail').boundingBox();
  assert.ok(compactCanvas && compactInspector && compactActivity);
  assert.ok(compactInspector.y >= compactCanvas.y + compactCanvas.height - 1);
  assert.ok(compactActivity.y >= compactInspector.y + compactInspector.height - 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log('PASS: workspace layout, focus view, sidebar, live cursors and canvas interactions.');
} finally {
  await browser.close();
}
