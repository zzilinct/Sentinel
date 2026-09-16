'use strict';
/** Static intelligence the scoring engine reads from. */

// Multi-label public suffixes we care about, so "bbc.co.uk" isn't read as "co.uk".
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'co.za', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.in', 'net.in', 'org.in', 'gov.in', 'co.kr', 'or.kr', 'com.sg', 'com.hk',
  'com.tw', 'co.il', 'com.pl', 'com.ua', 'com.ph', 'com.my', 'co.id', 'com.vn', 'gov.sg'
]);

// TLDs with a persistently high abuse ratio in public phishing feeds.
const RISKY_TLDS = {
  tk: 26, ml: 26, ga: 26, cf: 26, gq: 26,
  zip: 24, mov: 24, cyou: 24, sbs: 22, cfd: 22, rest: 20, quest: 22,
  top: 20, xyz: 16, icu: 20, buzz: 18, click: 20, link: 14, live: 12,
  work: 18, country: 20, kim: 18, loan: 22, download: 22, review: 16,
  shop: 12, store: 12, online: 14, site: 14, website: 14, space: 16,
  fit: 16, monster: 20, bar: 16, autos: 18, boats: 16, christmas: 16,
  lol: 16, mom: 16, pics: 16, wiki: 12, su: 20, cc: 12, pw: 20, am: 12
};

// Brands most often impersonated, with every domain they really own.
const PROTECTED_BRANDS = require('./brands').BRANDS;

// Words that carry real signal inside a hostname (in a path they are far more common).
const HOST_KEYWORDS = {
  // credential theft
  verify: 14, verification: 14, validate: 12, secure: 10, security: 10,
  account: 10, signin: 12, login: 12, logon: 12, auth: 8, update: 8,
  unlock: 14, suspended: 16, recovery: 12, recover: 12, confirm: 12,
  support: 10, helpdesk: 14, billing: 10, invoice: 10, password: 14,
  // money bait
  free: 12, gift: 14, giftcard: 18, giveaway: 18, bonus: 14, prize: 16,
  winner: 18, reward: 14, claim: 16, refund: 16, cashback: 14, lottery: 18,
  // crypto drainers
  airdrop: 20, presale: 16, wallet: 14, walletconnect: 20,
  restore: 12, seed: 12, staking: 12, doubler: 18, elon: 16,
  // shopping fraud
  outlet: 10, clearance: 12, liquidation: 14, closingdown: 16,
  // the same bait in the languages scam campaigns use most
  gratis: 12, premio: 16, premios: 16, ganador: 16, sorteo: 16, regalo: 14, cadeau: 14, gagnant: 16,
  gewinn: 16, gewinnspiel: 18, hadiah: 16, undian: 18, pemenang: 18, bonusan: 14, promo: 8,
  premiado: 16, sorteio: 16, brinde: 14, resgate: 14
};

const PATH_KEYWORDS = {
  'secure-login': 14,
  'account-verify': 14,
  'confirm-identity': 16,
  'connect-wallet': 18,
  'validate-seed': 22,
  'claim-reward': 16,
  'wp-admin/verify': 14,
  'signin/verify': 12,
  'webscr': 12,
  'cmd=_login': 14,
  'recovery-phrase': 22,
  'update-billing': 14,
  'unlock-account': 14,
  '/viewer/': 8,
  'docusign': 12,
  'shared-document': 12,
  'onedrive': 10,
  'sharepoint': 10,
  '/authen': 10,
  'wp-includes/secure': 16
};

const TECH_SUPPORT_WORDS = ['helpline', 'tollfree', 'techsupport', 'errorcode', 'alert', 'virusalert', 'defender', 'firewall', 'infected', 'warning'];
const DELIVERY_WORDS = ['parcel', 'redelivery', 'delivery', 'shipment', 'customs', 'tracking', 'package', 'postage'];
const GOV_WORDS = ['irs', 'hmrc', 'taxrefund', 'gov', 'medicare', 'socialsecurity', 'dmv', 'tolls', 'ezpass', 'fastrak'];

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly',
  'rb.gy', 'shorturl.at', 'rebrand.ly', 'tiny.cc', 'bl.ink', 'lnkd.in', 't.ly', 's.id',
  'v.gd', 'qrco.de', 'shorturl.gg', 'bitly.ws'
]);

// Free site builders and hosting subdomains: legitimate, but a favourite home for phishing kits.
const FREE_HOSTING = [
  '000webhostapp.com', 'weebly.com', 'wixsite.com', 'firebaseapp.com', 'web.app', 'github.io',
  'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'glitch.me', 'repl.co', 'replit.app',
  'blogspot.com', 'wordpress.com', 'square.site', 'webflow.io', 'framer.website', 'godaddysites.com',
  'myshopify.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'surge.sh', 'ngrok.io', 'ngrok-free.app',
  'trycloudflare.com', 'azurewebsites.net', 'appspot.com', 'r2.dev', 'ipfs.io', 'dweb.link', 'mystrikingly.com',
  'jimdosite.com', 'typedream.app', 'canva.site', 'notion.site', 'gitbook.io', 'weeblysite.com', 'framer.app',
  'bolt.host', 'webnode.page', 'carrd.co', 'glide.page', 'softr.app', 'bubbleapps.io', 'wixstudio.io', 'tilda.ws',
  'site123.me', 'yolasite.com', 'ucoz.net', 'blob.core.windows.net', 'web.core.windows.net', 'lovable.app',
  'webcindario.com', 'wcomhost.com', 'hpage.com', 'mozello.com', 'odoo.com', 'teachable.com', 'deno.dev', 'val.run'
];

// Path-based free hosting (the attacker controls the path, not a subdomain).
const PATH_HOSTING = ['sites.google.com', 'forms.gle', 'docs.google.com', 'storage.googleapis.com', 's3.amazonaws.com', 'linktr.ee', 'ipfs.io', 'dweb.link'];

// Dynamic DNS: throwaway hostnames that point at home or rented machines.
const DYNAMIC_DNS = [
  'duckdns.org', 'no-ip.com', 'ddns.net', 'hopto.org', 'zapto.org', 'sytes.net', 'serveftp.com',
  'myftp.biz', 'dynu.net', 'freedns.afraid.org', 'mooo.com', 'chickenkiller.com', 'ignorelist.com',
  'servehttp.com', 'redirectme.net', 'dyndns.org', 'linkpc.net', 'publicvm.com'
];

// Browser cryptominer script hosts.
const CRYPTOMINER_HOSTS = [
  'coinhive.com', 'coin-hive.com', 'authedmine.com', 'crypto-loot.com', 'cryptoloot.pro', 'webminepool.com',
  'minero.cc', 'jsecoin.com', 'coinimp.com', 'webmine.cz', 'monerominer.rocks', 'coinerra.com', 'ppoi.org',
  'cryptonight.pro', 'deepminer.co', 'minr.pw'
];

// Extensions that execute code when opened.
const EXECUTABLE_EXT = new Set([
  'exe', 'scr', 'msi', 'msix', 'bat', 'cmd', 'com', 'pif', 'cpl', 'hta', 'jar', 'js', 'jse',
  'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'psm1', 'lnk', 'reg', 'dll', 'apk', 'xapk', 'dmg', 'pkg',
  'app', 'deb', 'rpm', 'sh', 'appimage', 'iso', 'img', 'vhd', 'vhdx', 'chm', 'msc', 'xll', 'one'
]);
const MACRO_DOC_EXT = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam', 'ppam']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'cab', 'arj', 'ace', 'bz2', 'xz', 'z']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'mp3', 'mp4', 'csv', 'rtf']);

const FREE_MAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mail.com', 'gmx.com', 'gmx.net', 'proton.me',
  'protonmail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com', 'tutanota.com'
]);

// Sites the badge never appears on: search engines, top destinations, infrastructure.
const DEFAULT_ALLOWLIST = [
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'search.brave.com',
  'ecosia.org', 'startpage.com', 'baidu.com', 'yandex.com',
  'wikipedia.org', 'youtube.com', 'github.com', 'stackoverflow.com', 'reddit.com',
  'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com',
  'amazon.com', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'office.com',
  'openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'deepseek.com',
  'netflix.com', 'paypal.com', 'ebay.com', 'walmart.com', 'target.com', 'bestbuy.com',
  'nytimes.com', 'bbc.co.uk', 'bbc.com', 'cnn.com', 'theguardian.com', 'imdb.com', 'spotify.com',
  'dropbox.com', 'zoom.us', 'slack.com', 'notion.so', 'figma.com', 'stripe.com',
  'cloudflare.com', 'mozilla.org', 'w3.org', 'npmjs.com', 'python.org', 'nodejs.org',
  'developer.mozilla.org', 'gov.uk', 'usa.gov', 'irs.gov', 'nhs.uk', 'who.int', 'europa.eu',
  'sentinelscan.com'
];

// Seed threat data so every mask works on day one, before feeds are refreshed.
const SEED_BLOCKLIST = [
  { host: 'paypa1-secure-login.com', category: 'phishing', threat: 'scam' },
  { host: 'apple-id-verify-support.xyz', category: 'phishing', threat: 'scam' },
  { host: 'netflix-billing-update.top', category: 'phishing', threat: 'scam' },
  { host: 'metamask-wallet-restore.cfd', category: 'crypto_drainer', threat: 'scam' },
  { host: 'usps-redelivery-fee.sbs', category: 'smishing', threat: 'scam' },
  { host: 'amazon-refund-center.icu', category: 'phishing', threat: 'scam' },
  { host: 'crypto-doubler-elon.live', category: 'crypto_scam', threat: 'scam' },
  { host: 'nike-outlet-clearance90.top', category: 'fake_store', threat: 'scam' },
  { host: 'microsoft-support-alert.click', category: 'tech_support_scam', threat: 'scam' },
  { host: 'steamcommunlty.com', category: 'phishing', threat: 'scam' },
  { host: 'chrome-update-required.top', category: 'fake_update', threat: 'malware' },
  { host: 'flashplayer-update-now.xyz', category: 'fake_update', threat: 'malware' },
  { host: 'free-crack-downloads.icu', category: 'trojan_distribution', threat: 'virus' }
];

/**
 * Phrase sets that recur across phishing kits and scam templates. A page that
 * contains most of one set is compared to that known scam family.
 */
const SCAM_KITS = [
  { id: 'kit_m365', threat: 'scam', label: 'Microsoft 365 credential phishing kit', min: 3,
    phrases: ['sign in to your account', 'loginfmt', 'passwd', 'keep me signed in', 'microsoft', 'forgot my password'] },
  { id: 'kit_seed', threat: 'scam', label: 'Crypto wallet seed-phrase drainer', min: 2,
    phrases: ['recovery phrase', 'seed phrase', '12-word', '24-word', 'secret phrase', 'import wallet', 'private key', 'connect wallet'] },
  { id: 'kit_parcel', threat: 'scam', label: 'Parcel redelivery fee scam', min: 2,
    phrases: ['could not be delivered', 'incomplete address', 'redelivery', 'delivery fee', 'your package', 'update your address'] },
  { id: 'kit_bank', threat: 'scam', label: 'Bank account suspension phishing', min: 3,
    phrases: ['account has been suspended', 'unusual activity', 'verify your identity', 'restore access', 'online banking', 'card number'] },
  { id: 'kit_giveaway', threat: 'scam', label: 'Crypto giveaway / doubling scam', min: 2,
    phrases: ['send any amount', 'double your', 'giveaway', 'will be sent back', 'limited time', 'participate'] },
  { id: 'kit_techsupport', threat: 'scam', label: 'Tech-support scare page', min: 2,
    phrases: ['your computer has been blocked', 'call microsoft', 'toll free', 'do not close this window', 'virus detected', 'windows defender'] },
  { id: 'kit_store', threat: 'scam', label: 'Fake clearance store', min: 3,
    phrases: ['closing down sale', 'up to 90% off', 'limited stock', 'free shipping worldwide', 'last day', 'clearance'] },
  { id: 'kit_docshare', threat: 'scam', label: 'Shared-document login lure', min: 2,
    phrases: ['shared a document', 'view document', 'sign in to view', 'docusign', 'onedrive', 'secure file'] },
  { id: 'kit_fakeupdate', threat: 'malware', label: 'Fake browser update', min: 2,
    phrases: ['update your browser', 'browser is out of date', 'critical update', 'chrome update', 'download update', 'install now'] },
  { id: 'kit_clickfix', threat: 'malware', label: 'Fake CAPTCHA "ClickFix" command lure', min: 2,
    phrases: ['press windows', 'win + r', 'ctrl + v', 'verify you are human', 'powershell', 'mshta', 'i am not a robot'] },
  { id: 'kit_pushbait', threat: 'malware', label: 'Notification-permission bait', min: 2,
    phrases: ['click allow', 'to confirm you are not a robot', 'press allow', 'allow notifications', 'to watch the video'] }
];

module.exports = {
  MULTI_SUFFIXES, RISKY_TLDS, PROTECTED_BRANDS, HOST_KEYWORDS, PATH_KEYWORDS,
  TECH_SUPPORT_WORDS, DELIVERY_WORDS, GOV_WORDS, URL_SHORTENERS, FREE_HOSTING, DYNAMIC_DNS,
  CRYPTOMINER_HOSTS, EXECUTABLE_EXT, MACRO_DOC_EXT, ARCHIVE_EXT, DOC_EXT, FREE_MAIL_PROVIDERS,
  DEFAULT_ALLOWLIST, SEED_BLOCKLIST, SCAM_KITS, PATH_HOSTING
};
