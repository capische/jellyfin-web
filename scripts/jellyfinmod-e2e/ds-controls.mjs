// Operate the painted mockup field/list, including its TV and phone focus behavior.
export async function readScopeOptions(page) {
    const field = page.locator('#jfmod-releaseEpisode');
    if (!await field.count()) return [];
    const open = await field.getAttribute('aria-expanded') === 'true';
    if (!open) await field.click();
    const menu = page.locator('#jfmod-releaseEpisode-list');
    await menu.waitFor({ state: 'visible' });
    const options = await menu.locator('[role="option"]').evaluateAll(nodes => nodes.map(node => ({
        value: node.dataset.value, text: node.textContent, disabled: node.getAttribute('aria-disabled') === 'true', selected: node.getAttribute('aria-selected') === 'true'
    })));
    if (!open) {
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
    }
    return options;
}

export async function chooseScopeValue(page, value) {
    const field = page.locator('#jfmod-releaseEpisode');
    if (await field.getAttribute('aria-expanded') !== 'true') await field.click();
    // Attribute matching keeps identical episode names distinct.
    await page.locator(`#jfmod-releaseEpisode-list [role="option"][data-value=${JSON.stringify(value)}]`).click();
    await page.locator('#jfmod-releaseEpisode-list').waitFor({ state: 'detached' });
}
