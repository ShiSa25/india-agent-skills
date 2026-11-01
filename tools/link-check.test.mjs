import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cleanUrl, extractDocUrls, isBareEndpoint, isExampleHost } from './link-check.mjs';

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
