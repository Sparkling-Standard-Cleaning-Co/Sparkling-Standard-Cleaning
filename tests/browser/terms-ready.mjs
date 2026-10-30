export async function checkEstimateTerms(page) {
  await page.waitForFunction(() => {
    const summary = document.querySelector('[data-reservation-summary]');
    return summary && !summary.hasAttribute('hidden') && summary.getAttribute('data-revealing') !== 'true';
  });
  const terms = page.locator('#est-terms');
  await terms.scrollIntoViewIfNeeded();
  await terms.check({ force: true });
}
