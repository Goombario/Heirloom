export async function withBrowser(createBrowser, scan) {
  const browser = await createBrowser();
  try {
    return await scan(browser);
  } finally {
    await browser.close();
  }
}

export async function runConcurrently(tasks) {
  const outcomes = await Promise.allSettled(tasks.map((task) => task()));
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  if (rejected) throw rejected.reason;
  return outcomes.flatMap((outcome) => outcome.value);
}
