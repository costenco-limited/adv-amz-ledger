// Amazon financial events (fees, refunds, account charges), paged.
const { call, sleep } = require('./spapi');

// All financial events posted between two ISO timestamps
async function financialEvents(postedAfter, postedBefore) {
  const all = {};
  let nextToken = null;
  do {
    const query = nextToken
      ? `NextToken=${encodeURIComponent(nextToken)}`
      : `PostedAfter=${postedAfter}&PostedBefore=${postedBefore}&MaxResultsPerPage=100`;
    const r = await call('get', `/finances/v0/financialEvents?${query}`);
    for (const [list, events] of Object.entries(r.payload.FinancialEvents || {})) {
      if (Array.isArray(events) && events.length) (all[list] ??= []).push(...events);
    }
    nextToken = r.payload.NextToken;
    if (nextToken) await sleep(2100); // ~0.5 requests/second
  } while (nextToken);
  return all;
}

// Financial events for each day separately: { day: events }.
// Account-level charges (storage, subscription...) carry no PostedDate, so the day they
// were fetched for is the only date they have. `windows` is [[day, afterIso, beforeIso], ...].
async function financialEventsByDay(windows) {
  const byDay = {};
  for (const [day, after, before] of windows) {
    byDay[day] = await financialEvents(after, before);
    await sleep(2100);
  }
  return byDay;
}

const amount = m => m?.CurrencyAmount || 0;
const sum = (list, field) => (list || []).reduce((a, x) => a + amount(x[field]), 0);

module.exports = { financialEvents, financialEventsByDay, amount, sum };
