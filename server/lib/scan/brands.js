'use strict';
/**
 * Brands scammers impersonate, with every domain each brand really owns.
 * A brand name on any other domain is treated as impersonation, so the
 * official lists need to be complete - including country and short domains.
 */

const AMAZON_CC = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'co.jp', 'in', 'com.au', 'com.br', 'com.mx', 'nl', 'se', 'pl', 'sg', 'ae', 'sa', 'eg', 'com.tr', 'com.be', 'cn'];
const GOOGLE_CC = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'co.jp', 'co.in', 'com.au', 'com.br', 'com.mx', 'nl', 'se', 'pl', 'ru', 'com.sg', 'ae', 'com.tr', 'be', 'ch', 'at', 'dk', 'no', 'fi', 'ie', 'pt', 'gr', 'cz', 'co.za', 'co.nz', 'com.ar', 'cl', 'co.kr', 'com.hk', 'com.tw', 'co.id', 'com.ph', 'com.vn', 'com.my', 'co.th', 'com.pk', 'com.ng', 'com.sa', 'com.eg', 'co.il', 'hu', 'ro', 'com.ua'];
const EBAY_CC = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'com.au', 'nl', 'at', 'ch', 'ie', 'be', 'pl', 'com.sg', 'com.hk', 'com.my', 'ph'];

const cc = (name, list) => list.map((suffix) => `${name}.${suffix}`);

const BRANDS = [
  // Payments and banks
  { token: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-community.com', ...cc('paypal', ['co.uk', 'de', 'fr', 'it', 'es', 'ca', 'com.au'])] },
  { token: 'venmo', domains: ['venmo.com'] },
  { token: 'zelle', domains: ['zellepay.com'] },
  { token: 'cashapp', domains: ['cash.app', 'square.com', 'squareup.com'] },
  { token: 'stripe', domains: ['stripe.com', 'stripe.network'] },
  { token: 'wise', domains: ['wise.com', 'transferwise.com'] },
  { token: 'revolut', domains: ['revolut.com', 'revolut.me'] },
  { token: 'chase', domains: ['chase.com', 'jpmorganchase.com', 'jpmorgan.com'] },
  { token: 'wellsfargo', domains: ['wellsfargo.com', 'wf.com'] },
  { token: 'bankofamerica', domains: ['bankofamerica.com', 'bofa.com', 'ml.com'] },
  { token: 'citibank', domains: ['citi.com', 'citibank.com', 'citibankonline.com'] },
  { token: 'capitalone', domains: ['capitalone.com'] },
  { token: 'americanexpress', domains: ['americanexpress.com', 'amex.com', 'aexp.com'] },
  { token: 'amex', domains: ['americanexpress.com', 'amex.com', 'aexp.com'] },
  { token: 'usaa', domains: ['usaa.com'] },
  { token: 'truist', domains: ['truist.com'] },
  { token: 'santander', domains: ['santander.com', 'santander.co.uk', 'santanderbank.com'] },
  { token: 'hsbc', domains: ['hsbc.com', 'hsbc.co.uk', 'hsbc.com.hk', 'us.hsbc.com'] },
  { token: 'barclays', domains: ['barclays.co.uk', 'barclays.com', 'barclaycard.co.uk', 'barclaycardus.com'] },
  { token: 'natwest', domains: ['natwest.com'] },
  { token: 'lloyds', domains: ['lloydsbank.com', 'lloydsbankinggroup.com'] },
  { token: 'mastercard', domains: ['mastercard.com', 'mastercard.us'] },
  { token: 'interac', domains: ['interac.ca'] },
  { token: 'mercadopago', domains: ['mercadopago.com', 'mercadopago.com.br', 'mercadopago.com.mx', 'mercadopago.com.ar'] },

  // Big tech and accounts
  { token: 'apple', domains: ['apple.com', 'icloud.com', 'me.com', 'apple.co', 'mzstatic.com'] },
  { token: 'icloud', domains: ['icloud.com', 'apple.com'] },
  { token: 'microsoft', domains: ['microsoft.com', 'microsoftonline.com', 'microsoft365.com', 'live.com', 'outlook.com', 'office.com', 'windows.com', 'windows.net', 'azure.com', 'msn.com', 'bing.com', 'xbox.com', 'sharepoint.com', 'onedrive.com', 'skype.com', 'msauth.net', 'msftauth.net'] },
  { token: 'outlook', domains: ['outlook.com', 'live.com', 'office.com', 'microsoft.com', 'office365.com'] },
  { token: 'office365', domains: ['office.com', 'office365.com', 'microsoft.com'] },
  { token: 'onedrive', domains: ['onedrive.com', 'live.com', 'microsoft.com', 'sharepoint.com'] },
  { token: 'sharepoint', domains: ['sharepoint.com', 'microsoft.com'] },
  { token: 'google', domains: [...cc('google', GOOGLE_CC), 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'googlevideo.com', 'withgoogle.com', 'goo.gl', 'g.co', 'gmail.com', 'youtube.com', 'google'] },
  { token: 'gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'youtube', domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'youtube-nocookie.com'] },
  { token: 'amazon', domains: [...cc('amazon', AMAZON_CC), 'amazonaws.com', 'amazon.dev', 'a2z.com', 'amzn.to', 'media-amazon.com', 'primevideo.com', 'aboutamazon.com'] },
  { token: 'netflix', domains: ['netflix.com', 'nflxext.com', 'nflximg.net', 'netflix.net'] },
  { token: 'spotify', domains: ['spotify.com', 'spotify.link', 'scdn.co', 'spoti.fi'] },
  { token: 'adobe', domains: ['adobe.com', 'adobe.io', 'adobelogin.com', 'typekit.net'] },
  { token: 'dropbox', domains: ['dropbox.com', 'dropboxusercontent.com', 'db.tt'] },
  { token: 'docusign', domains: ['docusign.com', 'docusign.net'] },
  { token: 'tesla', domains: ['tesla.com', 'teslamotors.com'] },
  { token: 'nike', domains: ['nike.com', 'nike.net', 'swoosh.com'] },
  { token: 'rayban', domains: ['ray-ban.com', 'rayban.com', 'luxottica.com'] },
  { token: 'oakley', domains: ['oakley.com'] },
  { token: 'adidas', domains: ['adidas.com', 'adidas.co.uk', 'adidas.de'] },
  { token: 'adp', domains: ['adp.com', 'adp.ca', 'adp.co.uk', 'adp.fr', 'adp.de', 'adp.es', 'adp.it', 'adp.com.au', 'adpinfo.com'] },
  { token: 'workday', domains: ['workday.com', 'myworkday.com', 'workdaysuite.com'] },
  { token: 'wetransfer', domains: ['wetransfer.com', 'we.tl'] },
  { token: 'zoom', domains: ['zoom.us', 'zoom.com', 'zoomgov.com'] },
  { token: 'openai', domains: ['openai.com', 'chatgpt.com', 'oaistatic.com'] },
  { token: 'chatgpt', domains: ['chatgpt.com', 'openai.com'] },
  { token: 'anthropic', domains: ['anthropic.com', 'claude.ai', 'claude.com'] },
  { token: 'deepseek', domains: ['deepseek.com'] },

  // Social
  { token: 'facebook', domains: ['facebook.com', 'fb.com', 'fb.me', 'fbcdn.net', 'messenger.com', 'meta.com', 'facebook.net'] },
  { token: 'instagram', domains: ['instagram.com', 'cdninstagram.com', 'ig.me'] },
  { token: 'whatsapp', domains: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  { token: 'linkedin', domains: ['linkedin.com', 'lnkd.in', 'licdn.com'] },
  { token: 'tiktok', domains: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com'] },
  { token: 'discord', domains: ['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'discordapp.net'] },
  { token: 'telegram', domains: ['telegram.org', 't.me', 'telegram.me'] },
  { token: 'snapchat', domains: ['snapchat.com', 'snap.com'] },

  // Shopping and delivery
  { token: 'ebay', domains: cc('ebay', EBAY_CC).concat(['ebayimg.com', 'ebaystatic.com']) },
  { token: 'walmart', domains: ['walmart.com', 'walmart.ca', 'walmartimages.com'] },
  { token: 'shopify', domains: ['shopify.com', 'myshopify.com', 'shopifycdn.com'] },
  { token: 'shopee', domains: ['shopee.com', 'shopee.co.id', 'shopee.com.my', 'shopee.sg', 'shopee.ph', 'shopee.vn', 'shopee.co.th', 'shopee.tw', 'shopee.com.br'] },
  { token: 'aliexpress', domains: ['aliexpress.com', 'aliexpress.us', 'alicdn.com'] },
  { token: 'temu', domains: ['temu.com'] },
  { token: 'costco', domains: ['costco.com', 'costco.ca', 'costco.co.uk'] },
  { token: 'dhl', domains: ['dhl.com', 'dhl.de', 'dhl.co.uk', 'dhl.fr', 'dhlparcel.nl', 'dhl.nl'] },
  { token: 'fedex', domains: ['fedex.com'] },
  { token: 'usps', domains: ['usps.com', 'usps.gov'] },
  { token: 'ups', domains: ['ups.com'] },
  { token: 'royalmail', domains: ['royalmail.com', 'royalmailgroup.com'] },
  { token: 'evri', domains: ['evri.com'] },
  { token: 'canadapost', domains: ['canadapost-postescanada.ca', 'canadapost.ca'] },
  { token: 'auspost', domains: ['auspost.com.au'] },

  // Telecom
  { token: 'comcast', domains: ['comcast.com', 'comcast.net', 'xfinity.com'] },
  { token: 'xfinity', domains: ['xfinity.com', 'comcast.com', 'comcast.net'] },
  { token: 'verizon', domains: ['verizon.com', 'verizonwireless.com', 'vzw.com'] },
  { token: 'tmobile', domains: ['t-mobile.com', 'tmobile.com'] },

  // Crypto
  { token: 'binance', domains: ['binance.com', 'binance.us', 'bnbstatic.com'] },
  { token: 'coinbase', domains: ['coinbase.com', 'cbhq.net', 'base.org'] },
  { token: 'walletconnect', domains: ['walletconnect.com', 'walletconnect.network', 'walletconnect.org', 'reown.com'] },
  { token: 'metamask', domains: ['metamask.io'] },
  { token: 'trezor', domains: ['trezor.io'] },
  { token: 'kraken', domains: ['kraken.com'] },
  { token: 'metamask', domains: ['metamask.io'] },
  { token: 'trustwallet', domains: ['trustwallet.com'] },
  { token: 'ledger', domains: ['ledger.com', 'ledgerwallet.com'] },
  { token: 'trezor', domains: ['trezor.io'] },
  { token: 'blockchain', domains: ['blockchain.com'] },
  { token: 'uphold', domains: ['uphold.com'] },
  { token: 'phantom', domains: ['phantom.app', 'phantom.com'] },
  { token: 'exodus', domains: ['exodus.com'] },
  { token: 'opensea', domains: ['opensea.io'] },
  { token: 'robinhood', domains: ['robinhood.com'] },
  { token: 'bybit', domains: ['bybit.com'] },
  { token: 'kucoin', domains: ['kucoin.com'] },

  // Games
  { token: 'steam', domains: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steam-chat.com'] },
  { token: 'steamcommunity', domains: ['steamcommunity.com'] },
  { token: 'roblox', domains: ['roblox.com', 'rbxcdn.com', 'rbx.com'] },
  { token: 'epicgames', domains: ['epicgames.com', 'unrealengine.com'] },
  { token: 'playstation', domains: ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com'] },
  { token: 'nintendo', domains: ['nintendo.com', 'nintendo.net', 'nintendo.co.jp', 'nintendo.co.uk'] },

  // Government and tax
  { token: 'irs', domains: ['irs.gov'] },
  { token: 'hmrc', domains: ['gov.uk'] },
  { token: 'medicare', domains: ['medicare.gov', 'cms.gov'] }

];

module.exports = { BRANDS };
