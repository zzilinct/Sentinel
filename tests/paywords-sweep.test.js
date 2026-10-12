'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fromTitle, fromWords, kind } = require('../server/lib/scan/paywords');

// Honest shop, bank, news and help pages written for this test: the title and the short labels the companion's
// reader would pick up (headings, buttons, form labels; never links, footers or navigation). None of them sells a gift
// card or sends crypto, so none may raise the pay pause. The pages that do stay in paywords.test.js.
const HONEST = [
  ['a store home page', 'Home | Northwind Outfitters', ['New arrivals', 'Shop by category', 'Sign up for our newsletter', 'Email address', 'Subscribe']],
  ['a product page with a gift card promo', 'Trail Runner 2 - Northwind Outfitters', ['Trail Runner 2', 'Size', 'Add to cart', 'Free returns', 'Earn a $10 gift card with every $100 you spend']],
  ['a footer that is not a footer element', 'Linen Shirt | Maple & Co', ['Linen Shirt', 'Choose a size', 'Add to bag', 'Customer service', 'Gift cards', 'Store locator']],
  ['a checkout', 'Checkout - Maple & Co', ['Shipping address', 'Payment', 'Card number', 'Gift card or promo code', 'Apply', 'Place order']],
  ['a gift card balance page', 'Check your gift card balance - Maple & Co', ['Check your balance', 'Gift card number', 'PIN', 'Check balance']],
  ['a redeem page', 'Redeem a gift card - App Store', ['Redeem gift card or code', 'Enter code', 'Redeem']],
  ['gift card terms', 'Gift card terms and conditions | Maple & Co', ['Gift card terms', 'Expiry', 'Lost or stolen cards']],
  ['a help page about gift card scams', 'Gift card scams: what to know | Consumer help', ['Gift card scams', 'Why would someone ask me to buy gift cards?', 'What to do if you paid a scammer with a gift card']],
  ['a help page about crypto scams', 'Crypto scams and how to avoid them - Help Center', ['How crypto scams work', 'Someone asked me to send bitcoin', 'Report a scam']],
  ['a bank ATM help page', 'Bitcoin ATM scams | Your Bank', ['Bitcoin ATM scams', 'Never pay a stranger at a Bitcoin ATM', 'Call us']],
  ['a bank transfer page', 'Transfer money | Your Bank', ['Transfer money', 'From account', 'To', 'Amount', 'Reference', 'Transfer']],
  ['a bank page with a wallet heading', 'Payments | Your Bank', ['Send money', 'To', 'Amount', 'Send', 'Add your card to Apple Wallet']],
  ['a bank international transfer', 'International payments | Your Bank', ['Send money abroad', 'Recipient', 'Amount', 'Send', 'Mobile wallet transfers available in 30 countries']],
  ['a bank card page', 'Your cards | Your Bank', ['Freeze card', 'Add to Google Wallet', 'Report lost or stolen']],
  ['a money app request', 'Request money', ['Request', 'To', 'Amount', 'Note', 'Send request']],
  ['a crypto news article', 'Bitcoin price today: BTC climbs past record | Coin News', ['Bitcoin price today', 'Share', 'Sign up', 'Email address']],
  ['a crypto explainer', 'What is a wallet address? | Coin Basics', ['What is a wallet address?', 'How to find your wallet address', 'Related articles']],
  ['a crypto how-to', 'How to send Bitcoin: a beginner\'s guide - Coin Basics', ['How to send Bitcoin', 'Step 1: open your wallet', 'Step 2: paste the address']],
  ['an exchange help page', 'How do I withdraw crypto? - Exchange Help Center', ['How do I withdraw crypto?', 'Was this article helpful?', 'Yes', 'No']],
  ['crypto tax news', 'Crypto withdrawal limits explained - Finance Weekly', ['Crypto withdrawal limits explained', 'Read more']],
  ['an email client', 'Inbox - Mail', ['Compose', 'Send', 'To', 'Subject', 'Message']],
  ['a contact form', 'Contact us | Maple & Co', ['Contact us', 'Name', 'Email address', 'Message', 'Send']],
  ['a gift ideas article', 'Best gift card ideas for teachers - Gift Guide', ['Best gift card ideas', 'Our picks']],
  ['a gift card news story', 'Retailers report record gift card sales - Business News', ['Retailers report record gift card sales']],
  ['a lost card page', 'Lost or stolen gift card - Help', ['Lost or stolen gift card', 'Contact us']],
  ['a grocery store', 'Weekly deals | Fresh Market', ['Weekly deals', 'Add to cart', '$2.99', 'Quantity', 'Gift cards available at the register']],
  ['a cinema', 'Tickets | City Cinema', ['Choose seats', 'Adult', 'Child', 'Amount', 'Pay', 'Gift vouchers at the box office']],
  ['a charity donation', 'Donate | Clean Water Trust', ['Choose an amount', '$25', '$50', '$100', 'Other amount', 'Donate']],
  ['a utility bill page', 'Pay your bill | City Power', ['Pay your bill', 'Amount', 'Card number', 'Pay now']],
  ['a gift card policy in a help centre', 'Gift cards FAQ | Store help', ['Can I return a gift card?', 'Gift cards FAQ']],
  ['a blockchain news page', 'Ethereum upgrade goes live - Chain Times', ['Ethereum upgrade goes live', 'Transfer fees fall', 'Newsletter', 'Send']],
  ['a wallet app settings screen', 'Settings - Wallet', ['Security', 'Backup phrase', 'Network', 'Currency', 'Save']]
];

for (const [name, title, words] of HONEST) {
  test(`an honest page raises no pay pause: ${name}`, () => {
    assert.equal(fromTitle(title), null, 'title');
    assert.equal(fromTitle(`${title} - Google Chrome`), null, 'window title');
    assert.equal(fromWords(words), null, 'words');
    assert.equal(kind({ title, words }), null);
  });
}

test('the sweep is at least 30 pages', () => assert.ok(HONEST.length >= 30, String(HONEST.length)));

test('pages that sell or send are still known, also with a scam note on them', () => {
  assert.equal(fromWords(['Send BTC', 'Beware of scams', 'Recipient address']), 'crypto', 'a note is left out, the label still counts');
  assert.equal(fromWords(['Withdraw', 'Address', 'Network', 'USDT', 'Never share your seed phrase']), 'crypto');
  assert.equal(fromWords(['eGift cards', '$25', '$50', 'Other amount']), 'gift');
  assert.equal(fromTitle('Withdraw USDT | Exchange - Google Chrome'), 'crypto');
  assert.equal(fromTitle('Bitcoin ATMs near you - Map'), 'crypto');
});
