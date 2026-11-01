/** General-information line printed by every tax, legal, and payment script. */
export const DISCLAIMER_TEMPLATE =
  'This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of {asOf} and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.';

/** Required sentence when an output depends on a rule with verified:false. */
export const CONFIRM_SENTENCE = 'Confirm with the official source before relying on this.';

const ASOF = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * @param {string} asOf YYYY-MM-DD
 * @returns {string}
 */
export function disclaimer(asOf) {
  if (typeof asOf !== 'string' || !ASOF.test(asOf)) {
    throw new TypeError('asOf must be YYYY-MM-DD');
  }
  return DISCLAIMER_TEMPLATE.replaceAll('{asOf}', asOf);
}
