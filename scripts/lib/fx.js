// Daily ECB exchange rates (EUR base) via frankfurter, for converting non-euro marketplaces.
const axios = require('axios');

// AED and SAR are not published by the ECB; both are pegged to the US dollar
const USD_PEGS = { AED: 3.6725, SAR: 3.75 };

// Returns rate(date, currency) = units of currency per 1 EUR on that date (last published rate on or before it)
async function loadRates(fromDate, toDate) {
  const url = `https://api.frankfurter.dev/v1/${fromDate}..${toDate}?base=EUR&symbols=GBP,SEK,PLN,USD`;
  const { data } = await axios.get(url, { timeout: 30000 });
  const days = Object.keys(data.rates).sort();
  if (!days.length) throw new Error('No exchange rates returned');

  return function rate(date, currency) {
    if (currency === 'EUR' || !currency) return 1;
    // latest business day on or before `date` (or the first available one)
    let day = days[0];
    for (const d of days) { if (d <= date) day = d; else break; }
    const r = data.rates[day];
    if (USD_PEGS[currency]) return r.USD * USD_PEGS[currency];
    if (!r[currency]) throw new Error(`No exchange rate for ${currency}`);
    return r[currency];
  };
}

module.exports = { loadRates };
