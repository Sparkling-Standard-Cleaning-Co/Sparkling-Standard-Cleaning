export async function checkEstimateTerms(page) {
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-reservation-summary]');
    return summary && !summary.hasAttribute('hidden') && summary.getAttribute('data-revealing') !== 'true';
  });
  const terms = page.locator('#est-terms');
  await terms.scrollIntoViewIfNeeded();
  await terms.evaluate((element) => { if (!element.checked) element.click(); });
  await page.waitForFunction(() => document.querySelector('#est-terms')?.checked === true);
}
