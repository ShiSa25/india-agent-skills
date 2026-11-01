import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyLink, cleanUrl, extractDocUrls, isBareEndpoint, isExampleHost, summarizeLinkResults } from './link-check.mjs';

describe('link-check extraction', () => {
  test('strips trailing markdown punctuation', () => {
    assert.equal(cleanUrl('https://razorpay.com/docs/api/orders/create.'), 'https://razorpay.com/docs/api/orders/create');
    assert.equal(cleanUrl('https://mcp.razorpay.com/mcp`'), 'https://mcp.razorpay.com/mcp');
    assert.equal(cleanUrl('https://mcp.cashfree.com/mcp`)'), 'https://mcp.cashfree.com/mcp');
  });

  test('skips code spans, fences, example hosts, and bare endpoints', () => {
    const text = [
      'See [orders](https://razorpay.com/docs/api/orders/create).',
      'Remote endpoint `https://mcp.razorpay.com/mcp`.',
      'SSE `https://mcp.razorpay.com/sse`.',
      'Cashfree `https://mcp.cashfree.com/mcp`.',
      'POST `https://control.msg91.com/api/v5/otp`.',
      'Pay at https://pay.example/x today.',
      'Also https://shop.example.com/invoice.',
      '```',
      'curl https://api.razorpay.com/v1/orders',
      '```',
      'Bare MCP https://mcp.razorpay.com/mcp still skipped.',
      'Bare OTP https://control.msg91.com/api/v5/otp stays on the allowlist.',
      'A real docs link https://www.cashfree.com/docs/tools-ai/mcp-server is kept.',
    ].join('\n');
    const urls = extractDocUrls(text);
    assert.deepEqual(urls.sort(), [
      'https://razorpay.com/docs/api/orders/create',
      'https://www.cashfree.com/docs/tools-ai/mcp-server',
    ]);
  });

  test('example hosts and bare endpoints are classified', () => {
    assert.equal(isExampleHost('pay.example'), true);
    assert.equal(isExampleHost('example.com'), true);
    assert.equal(isExampleHost('shop.example.com'), true);
    assert.equal(isExampleHost('razorpay.com'), false);
    assert.equal(isExampleHost('notexample.com'), false);
    assert.equal(isBareEndpoint('https://mcp.cashfree.com/mcp'), true);
    assert.equal(isBareEndpoint('https://control.msg91.com/api/v5/otp'), true);
    assert.equal(isBareEndpoint('https://razorpay.com/docs/api/orders/create'), false);
  });
});

describe('link classification', () => {
  const url = 'https://www.indiacode.nic.in/handle/123456789/22037';

  test('only 404 and 410 are fatal', () => {
    assert.equal(classifyLink(url, { status: 404 }).kind, 'fail');
    assert.equal(classifyLink(url, { status: 410 }).kind, 'fail');
    assert.equal(classifyLink(url, { status: 200 }).kind, 'ok');
    assert.equal(classifyLink(url, { status: 301 }).kind, 'ok');
    for (const status of [401, 403, 429, 500, 502, 503]) {
      const result = classifyLink(url, { status });
      assert.equal(result.kind, 'warn', String(status));
      assert.match(result.line, new RegExp(`^WARN ${status} `));
    }
  });

  test('transport errors warn and do not fail the run', () => {
    const cases = [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UND_ERR_CONNECT_TIMEOUT',
      'ENOTFOUND',
      'The operation was aborted due to timeout',
    ];
    const results = cases.map((error) => classifyLink(url, { error }));
    for (const result of results) assert.equal(result.kind, 'warn');
    assert.match(results.at(-1).line, /aborted due to timeout/);
    const summary = summarizeLinkResults([
      ...results,
      classifyLink('https://www.cbic.gov.in/', { error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
      classifyLink('https://einvoice1.gst.gov.in/Others/MasterCodes', { error: 'UND_ERR_CONNECT_TIMEOUT' }),
      classifyLink('https://razorpay.com/docs/api/orders/create', { status: 200 }),
    ]);
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.warnings.length, 6);
  });

  test('a dead link still exits 1 alongside warnings', () => {
    const summary = summarizeLinkResults([
      classifyLink(url, { error: 'The operation was aborted due to timeout' }),
      classifyLink(url, { status: 404 }),
      classifyLink(url, { status: 410 }),
      classifyLink(url, { status: 503 }),
    ]);
    assert.deepEqual(summary.failures, [`404 ${url}`, `410 ${url}`]);
    assert.equal(summary.warnings.length, 2);
    assert.equal(summary.exitCode, 1);
  });
});
