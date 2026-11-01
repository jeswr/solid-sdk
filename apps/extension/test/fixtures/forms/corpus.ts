// AUTHORED-BY Codex GPT-6.1-Sol
import type { FieldKind } from '../../../src/content/formfill/detect';

interface FormFixture {
  readonly name: string;
  readonly html: string;
  readonly confidence: 'autocomplete' | 'heuristic';
  readonly expected: Readonly<Record<string, FieldKind>>;
}

/** Synthetic HTML strings model common production form structures, without external requests. */
export const forms: readonly FormFixture[] = [
  {
    name: 'checkout with independent shipping and billing sections',
    html: `<form>
      <fieldset><legend>Ship to</legend>
        <input id="ship-name" autocomplete="section-delivery shipping name">
        <textarea id="ship-street" autocomplete="section-delivery shipping street-address"></textarea>
        <input id="ship-city" autocomplete="section-delivery shipping address-level2">
      </fieldset>
      <fieldset><legend>Bill to</legend>
        <input id="bill-name" autocomplete="section-payment billing name">
        <input id="bill-postal" autocomplete="section-payment billing postal-code">
        <input id="bill-card" autocomplete="section-payment billing cc-number">
      </fieldset><button>Place order</button></form>`,
    confidence: 'autocomplete',
    expected: {
      'ship-name': 'name',
      'ship-street': 'street-address',
      'ship-city': 'address-level2',
      'bill-name': 'name',
      'bill-postal': 'postal-code',
    },
  },
  {
    name: 'account signup',
    html: `<form><input id="first" autocomplete="given-name"><input id="last" autocomplete="family-name">
      <input id="email" type="email" autocomplete="email">
      <input id="password" type="password" autocomplete="new-password"><button>Sign up</button></form>`,
    confidence: 'autocomplete',
    expected: { first: 'given-name', last: 'family-name', email: 'email' },
  },
  {
    name: 'contact-us with associated and wrapping labels',
    html: `<form><label for="sender">Your name *</label><input id="sender" name="sender">
      <label>Email address <input id="reply" name="reply_to"></label>
      <label for="message">Message</label><textarea id="message"></textarea><button>Send</button></form>`,
    confidence: 'heuristic',
    expected: { sender: 'name', reply: 'email' },
  },
  {
    name: 'newsletter subscription',
    html: `<form><input id="newsletter" type="email" placeholder="Your email address">
      <label><input type="checkbox" name="email_consent">Subscribe</label><button>Join</button></form>`,
    confidence: 'heuristic',
    expected: { newsletter: 'email' },
  },
  {
    name: 'address-book editor',
    html: `<form><input id="full" autocomplete="name"><input id="company" autocomplete="organization">
      <input id="work-email" autocomplete="section-business work email">
      <input id="home-phone" autocomplete="section-personal home tel">
      <input id="country" autocomplete="country-name"></form>`,
    confidence: 'autocomplete',
    expected: {
      full: 'name',
      company: 'organization',
      'work-email': 'email',
      'home-phone': 'tel',
      country: 'country-name',
    },
  },
  {
    name: 'government labels with opaque control identifiers',
    html: `<form><label for="q1">Given name</label><input id="q1">
      <label for="q2">Surname</label><input id="q2">
      <label for="q3">Street and house number</label><input id="q3">
      <label for="q4">Town or city</label><input id="q4">
      <label for="q5">State or province</label><input id="q5">
      <label for="q6">Postal code</label><input id="q6"></form>`,
    confidence: 'heuristic',
    expected: {
      q1: 'given-name',
      q2: 'family-name',
      q3: 'address-line1',
      q4: 'address-level2',
      q5: 'address-level1',
      q6: 'postal-code',
    },
  },
  {
    name: 'password explicitly disabling autocomplete',
    html: `<form><label>Email password<input id="secret" type="password" autocomplete="off" name="email"></label></form>`,
    confidence: 'heuristic',
    expected: {},
  },
  {
    name: 'credit-card payment form',
    html: `<form><input name="name" autocomplete="cc-name"><input name="email" autocomplete="cc-number">
      <input name="postal_code" autocomplete="cc-exp"><input autocomplete="cc-csc">
      <input name="phone" autocomplete="one-time-code"><button>Pay</button></form>`,
    confidence: 'heuristic',
    expected: {},
  },
  {
    name: 'Shopify-like nested checkout names',
    html: `<form><input id="shop-first" name="checkout[shipping_address][first_name]">
      <input id="shop-last" name="checkout[shipping_address][last_name]">
      <input id="shop-address" name="checkout[shipping_address][address1]">
      <input id="shop-apt" name="checkout[shipping_address][address2]">
      <input id="shop-zip" name="checkout[shipping_address][zip]">
      <input type="hidden" name="checkout[email]"></form>`,
    confidence: 'heuristic',
    expected: {
      'shop-first': 'given-name',
      'shop-last': 'family-name',
      'shop-address': 'address-line1',
      'shop-apt': 'address-line2',
      'shop-zip': 'postal-code',
    },
  },
  {
    name: 'WooCommerce-like billing details',
    html: `<form><input id="billing_first_name" autocomplete="billing given-name">
      <input id="billing_last_name" autocomplete="billing family-name">
      <input id="billing_company" autocomplete="billing organization">
      <input id="billing_address_1" autocomplete="billing address-line1">
      <input id="billing_address_2" autocomplete="billing address-line2">
      <input id="billing_state" autocomplete="billing address-level1">
      <select id="billing_country" autocomplete="billing country"><option>GB</option></select></form>`,
    confidence: 'autocomplete',
    expected: {
      billing_first_name: 'given-name',
      billing_last_name: 'family-name',
      billing_company: 'organization',
      billing_address_1: 'address-line1',
      billing_address_2: 'address-line2',
      billing_state: 'address-level1',
      billing_country: 'country',
    },
  },
  {
    name: 'Stripe-like address element inside its own document',
    html: `<form><div class="p-AddressElement"><input id="stripe-name" autocomplete="section-address shipping name">
      <select id="stripe-country" autocomplete="section-address shipping country"><option value="">Country</option></select>
      <input id="stripe-line1" autocomplete="section-address shipping address-line1">
      <input id="stripe-line2" autocomplete="section-address shipping address-line2">
      <input id="stripe-postal" autocomplete="section-address shipping postal-code"></div></form>`,
    confidence: 'autocomplete',
    expected: {
      'stripe-name': 'name',
      'stripe-country': 'country',
      'stripe-line1': 'address-line1',
      'stripe-line2': 'address-line2',
      'stripe-postal': 'postal-code',
    },
  },
  {
    name: 'UK postal address',
    html: `<form><label for="uk1">Address line 1</label><input id="uk1">
      <label for="uk2">Address line 2 (optional)</label><input id="uk2">
      <label for="uk3">Town</label><input id="uk3"><label for="uk4">County</label><input id="uk4">
      <label for="uk5">Postcode</label><input id="uk5"><label for="uk6">Country</label><select id="uk6"><option>United Kingdom</option></select></form>`,
    confidence: 'heuristic',
    expected: {
      uk1: 'address-line1',
      uk2: 'address-line2',
      uk3: 'address-level2',
      uk4: 'address-level1',
      uk5: 'postal-code',
      uk6: 'country-name',
    },
  },
  {
    name: 'placeholder-only contact form',
    html: `<form><input id="p1" placeholder="Full name"><input id="p2" placeholder="Email">
      <input id="p3" placeholder="Mobile number"><input id="p4" placeholder="Organisation">
      <textarea id="p5" placeholder="Street address"></textarea></form>`,
    confidence: 'heuristic',
    expected: { p1: 'name', p2: 'email', p3: 'tel', p4: 'organization', p5: 'street-address' },
  },
];
