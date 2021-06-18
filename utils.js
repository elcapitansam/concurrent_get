const { https } = require('http-debug');

https.debug = 0; // 1 for requests, 2 for everything

function boolify(value) {
  return value == true || value == 'true';
}

function encodeURIParam(name, value) {
  return encodeURIComponent(name) +
          '=' +
          encodeURIComponent(value);
}

function encodeURIQuery(params) {
  let separator = '?';
  let query = '';

  for (const arg of Object.keys(params)) {
    query += separator + encodeURIParam(arg, params[arg]);
    separator = '&';
  }
  return query;
}

function getJSON(data) {
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function httpsRequest(options, endFn, errorFn, postData) {
  options.headers['Content-Length'] = postData ? postData.length : 0;

  const req = https.request(options, (res) => {
    let response = '';

    res.on('data', (chunk) => {
      response += chunk;
    });
    res.on('end', () => {
      endFn(response);
    });
  });
  req.on('error', (e) => {
    errorFn(e);
  });
  if (postData) {
    req.write(postData);
  }
  req.end();
}

async function chunkConcurrent(asyncFunc, jobArray, chunkFactor = 20) {
  if (!asyncFunc || !jobArray || !chunkFactor) {
    return [];
  }
  const results = [];
  for (let i = 0; i < jobArray.length; i += chunkFactor) {
    const promises = [];
    const thisChunk = jobArray.slice(i, i + chunkFactor);
    for (const input of thisChunk) {
      promises.push(asyncFunc(input));
    }
    results.push(...(await Promise.allSettled(promises)));
  }
  return results;
}

class PromisePool {
  constructor(concurrencyLimit = 20) {
    this.concurrency = 0;
    this.concurrencyLimit = concurrencyLimit;

    this.gateResolves = [];
    this.pool = [];
    this.errors;
  }

  async _enqueueRunner() {
    return new Promise(((resolve) => {
      this.gateResolves.push(resolve);
    }).bind(this));
  }

  _dequeueRunner() {
    const resolve = this.gateResolves.shift();
    if (resolve) {
      resolve();
    }
  }

  async _drainRunners() {
    if (this.gateResolves.length == 0) {
      return;
    }
    await this._enqueueRunner();
  }

  async run(asyncFunc) {
    for (;;) {
      if (this.concurrency < this.concurrencyLimit) {
        this.concurrency += 1;
        this.pool.push(asyncFunc().finally((output => {
          this.concurrency -= 1;
          this._dequeueRunner();
          return output;
        }).bind(this)));
        return;
      }
      await this._enqueueRunner();
    }
  }

  async allSettledResults() {
    await this._drainRunners();
    this.errors = {};
    const mapResult = (result, index) => {
      switch (result.status) {
        case 'fulfilled':
          return result.value;
        case 'rejected':
          this.errors[index] = result.reason;
          return undefined;
        default:
          return undefined;
      }
    };
    const asResults = await Promise.allSettled(this.pool);
    return asResults.map(mapResult.bind(this));
  }
}

class RetryHandle {
  constructor(isValidRspFn, sendLimit, httpsRequestSend = httpsRequest) {
    this.isValidRsp = isValidRspFn;
    this.tries = 1;
    this.sendLimit = sendLimit;
    this.httpsRequestSend = httpsRequestSend;
  }

  shouldRetry(response) {
    if (response && this.isValidRsp(response)) {
      return false;
    }
    if (this.tries >= this.sendLimit) {
      return false;
    }
    this.tries++;
    return true;
  }
}

class RetryIt {
  constructor(sendLimit, httpsRequestSend = httpsRequest) {
    this.sendLimit = sendLimit;
    this.httpsRequestSend = httpsRequestSend;
  }

  _httpsRequest(retryHandle, options, endFn, errorFn, postData) {
    function send() {
      retryHandle.httpsRequestSend(options, endRetryFn, errorRetryFn, postData);
    }
    function endRetryFn(response) {
      if (retryHandle.shouldRetry(response)) {
        console.log('retrying for %O', options);
        send();
      } else {
        endFn(response);
      }
    }
    function errorRetryFn(e) {
      if (retryHandle.shouldRetry()) {
        console.log('error, retrying for %O', options);
        console.log(e);
        send();
      } else {
        errorFn(e);
      }
    }
    send();
  }

  httpsRequest(isValidRsp, ...requestArgs) {
    const handle = new RetryHandle(isValidRsp, this.sendLimit, this.httpsRequestSend);
    this._httpsRequest(handle, ...requestArgs);
  }
}

module.exports = { boolify, chunkConcurrent, encodeURIParam, encodeURIQuery, getJSON, httpsRequest, PromisePool, RetryIt };
