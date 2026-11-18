// Shared address-first Step 1 helpers for browser tests.
export async function confirmAddressFirst(page, options = {}) {
  const street = options.street ?? '100 S Baylen St';
  const city = options.city ?? 'Pensacola';
  const zip = options.zip ?? '32502';
  await page.locator('[data-address-card]').waitFor({ state: 'visible' });
  const finder = page.locator('[data-address-finder]');
  if ((await finder.getAttribute('data-state')) !== 'confirmed') {
    await page.fill('#est-address', street);
    await page.fill('#est-address-city', city);
    await page.fill('#est-zip', zip);
    const resolve = page.locator('[data-address-resolve]');
    if (await resolve.isVisible().catch(() => false)) await resolve.click();
    await page.locator('[data-address-map]').waitFor({ state: 'visible' });
    await page.locator('[data-address-confirm]').click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-address-finder]')?.getAttribute('data-state') === 'confirmed',
    );
  }
  await page.locator('[data-schedule-section]').waitFor({ state: 'visible' });
}

export async function chooseAppointment(page, date, period = 'first') {
  await page.fill('#est-date', date);
  await page.waitForSelector(`[data-period="${period}"]:not([disabled])`, { state: 'visible' });
  await page.click(`[data-period="${period}"]`);
}

export async function completeStepOne(page, options = {}) {
  await confirmAddressFirst(page, options);
  await chooseAppointment(page, options.date, options.period ?? 'first');
}
