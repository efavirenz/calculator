import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokensToPlainText,
  stripLeadingZeros,
  addThousandsSeparators,
  formatExpressionWithCommas,
} from '../js/formatUtils.js';

test('stripLeadingZeros handles basic numbers and edge cases', () => {
  assert.equal(stripLeadingZeros('001'), '1');
  assert.equal(stripLeadingZeros('001.5'), '1.5');
  assert.equal(stripLeadingZeros('0.001'), '0.001');
  assert.equal(stripLeadingZeros('0'), '0');
  assert.equal(stripLeadingZeros('-007.2'), '-7.2');
  assert.equal(stripLeadingZeros('1e+10'), '1e+10');
});

test('addThousandsSeparators formats integer parts with commas', () => {
  assert.equal(addThousandsSeparators('1000'), '1,000');
  assert.equal(addThousandsSeparators('1234567.89'), '1,234,567.89');
  assert.equal(addThousandsSeparators('-9876543'), '-9,876,543');
  assert.equal(addThousandsSeparators('100'), '100');
  assert.equal(addThousandsSeparators('1.5e+20'), '1.5e+20');
});

test('formatExpressionWithCommas formats numbers in math expressions', () => {
  assert.equal(formatExpressionWithCommas('1000+20000'), '1,000+20,000');
  assert.equal(formatExpressionWithCommas('(12345×6789)'), '(12,345×6,789)');
});

test('tokensToPlainText converts token streams accurately', () => {
  const tokens = [
    { char: '2', kind: 'digit', isExponent: false, hidden: false },
    { char: '^', kind: 'operator', isExponent: false, hidden: true },
    { char: '3', kind: 'digit', isExponent: true, hidden: false },
  ];
  assert.equal(tokensToPlainText(tokens), '2³');
});
