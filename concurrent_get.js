#!/usr/bin/env node

const utils = require('./utils');


/* [node, this_file, iterations, concurrency, url */
if (process.argv.length != 5) {
  console.error(`usage: ${process.argv[1].split('/').pop()} <iterations> <concurrency> <https_url>`);
  process.exit(1);
}

async function get(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Accept: 'application/json',
        'Content-type': 'application/json',
//        Authorization: `Basic ${authInfo}`
      },
      method: 'GET',
      host: url.host,
      path: url.pathname,
      timeout: 10 * 1000
    };

    utils.httpsRequest(options, response => {
      const resObj = utils.getJSON(response);
      if (!resObj) {
        console.log('response getJSON failure:', response);
        resolve(0);
      } else {
        resolve(1);
      }
    }, error => {
      reject(error);
    });
  });
}

async function getConcurrent(iterations, concurrency, url) {
  const urlObj = new URL(url);
  const pool = new utils.PromisePool(concurrency);

  console.error(`starting ${iterations} iterations with ${concurrency} concurrency ...`);
  for (let i = 0; i < iterations; i++) {
    process.stderr.write(`${i}              \r`);
    await pool.run(async () => {
      return await get(urlObj);
    });
  }

  const results = await pool.allSettledResults();
  const summary = { good: 0, bad: 0, errors: 0 };
  results.forEach((element, index) => {
    switch (element) {
      case 1:
        summary.good += 1;
        break;
      case 0:
        summary.bad += 1;
        break;
      case undefined:
        summary.errors += 1;
        console.log("pool error:", pool.errors[index]);
        break;
      default:
        console.error("unknown resolution:", currentValue);
        break;
    }
  }, summary);
  return summary;
}

(async () => {
  console.log('summary:', await getConcurrent(process.argv[2], process.argv[3], process.argv[4]));
})();
