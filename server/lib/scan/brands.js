'use strict';
/**
 * Brands scammers impersonate, with every domain each brand really owns.
 * A brand name on any other domain is treated as impersonation, so the
 * official lists need to be complete - including country and short domains.
 */

const AMAZON_CC = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'co.jp', 'in', 'com.au', 'com.br', 'com.mx', 'nl', 'se', 'pl', 'sg', 'ae', 'sa', 'eg', 'com.tr', 'com.be', 'cn', 'co.za'];
const GOOGLE_CC = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'co.jp', 'co.in', 'com.au', 'com.br', 'com.mx', 'nl', 'se', 'pl', 'ru', 'com.sg', 'ae', 'com.tr', 'be', 'ch', 'at', 'dk', 'no', 'fi', 'ie', 'pt', 'gr', 'cz', 'co.za', 'co.nz', 'com.ar', 'cl', 'co.kr', 'com.hk', 'com.tw', 'co.id', 'com.ph', 'com.vn', 'com.my', 'co.th', 'com.pk', 'com.ng', 'com.sa', 'com.eg', 'co.il', 'hu', 'ro', 'com.ua', 'lk'];
const EBAY_CC = ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'ca', 'com.au', 'nl', 'at', 'ch', 'ie', 'be', 'pl', 'com.sg', 'com.hk', 'com.my', 'ph'];

const cc = (name, list) => list.map((suffix) => `${name}.${suffix}`);

const BRANDS = [
  // Payments and banks
  { token: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-community.com', 'paypalhere.com', ...cc('paypal', ['co.uk', 'de', 'fr', 'it', 'es', 'nl', 'ca', 'com.au'])] },
  { token: 'venmo', domains: ['venmo.com'] },
  { token: 'zelle', domains: ['zellepay.com', 'zelle.com'] },
  { token: 'cashapp', domains: ['cash.app', 'square.com', 'squareup.com'] },
  { token: 'stripe', domains: ['stripe.com', 'stripe.network'] },
  { token: 'wise', domains: ['wise.com', 'transferwise.com'] },
  { token: 'revolut', domains: ['revolut.com', 'revolut.me'] },
  { token: 'chase', domains: ['chase.com', 'chase.co.uk', 'jpmorganchase.com', 'jpmorgan.com'] },
  { token: 'wellsfargo', domains: ['wellsfargo.com', 'wf.com'] },
  { token: 'bankofamerica', domains: ['bankofamerica.com', 'bofa.com', 'ml.com'] },
  { token: 'citibank', domains: ['citi.com', 'citibank.com', 'citibankonline.com'] },
  { token: 'capitalone', domains: ['capitalone.com'] },
  { token: 'americanexpress', domains: ['americanexpress.com', 'amex.com', 'aexp.com'] },
  { token: 'amex', domains: ['americanexpress.com', 'amex.com', 'aexp.com'] },
  { token: 'usaa', domains: ['usaa.com'] },
  { token: 'truist', domains: ['truist.com'] },
  { token: 'santander', domains: ['santander.com', 'santander.co.uk', 'santander.es', 'santanderbank.com'] },
  { token: 'hsbc', domains: ['hsbc.com', 'hsbc.co.uk', 'hsbc.com.hk', 'hsbc.fr', 'us.hsbc.com'] },
  { token: 'barclays', domains: ['barclays.co.uk', 'barclays.com', 'barclaycard.co.uk', 'barclaycardus.com'] },
  { token: 'natwest', domains: ['natwest.com'] },
  { token: 'lloyds', domains: ['lloydsbank.com', 'lloydsbank.co.uk', 'lloydsbankinggroup.com'] },
  { token: 'mastercard', domains: ['mastercard.com', 'mastercard.us'] },
  { token: 'interac', domains: ['interac.ca'] },
  { token: 'mercadopago', domains: ['mercadopago.com', 'mercadopago.com.br', 'mercadopago.com.mx', 'mercadopago.com.ar'] },

  // Big tech and accounts
  { token: 'apple', domains: ['apple.com', 'apple.com.cn', 'apple.news', 'icloud.com', 'me.com', 'apple.co', 'mzstatic.com'] },
  { token: 'icloud', domains: ['icloud.com', 'apple.com'] },
  { token: 'microsoft', domains: ['microsoft.com', 'microsoftonline.com', 'microsoft365.com', 'microsoftedge.com', 'live.com', 'outlook.com', 'office.com', 'windows.com', 'windows.net', 'azure.com', 'msn.com', 'bing.com', 'xbox.com', 'sharepoint.com', 'onedrive.com', 'skype.com', 'msauth.net', 'msftauth.net', 'windowsupdate.com', 'update.microsoft.com', 'microsoftedgeinsider.com'] },
  { token: 'outlook', domains: ['outlook.com', 'live.com', 'office.com', 'microsoft.com', 'office365.com'] },
  { token: 'office365', domains: ['office.com', 'office365.com', 'microsoft.com'] },
  { token: 'onedrive', domains: ['onedrive.com', 'live.com', 'microsoft.com', 'sharepoint.com'] },
  { token: 'sharepoint', domains: ['sharepoint.com', 'microsoft.com'] },
  { token: 'google', domains: [...cc('google', GOOGLE_CC), 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'googlevideo.com', 'withgoogle.com', 'googlemail.com', 'goo.gl', 'g.co', 'gmail.com', 'youtube.com', 'google'] },
  { token: 'gmail', domains: ['gmail.com', 'google.com'] },
  { token: 'youtube', domains: ['youtube.com', 'youtu.be', 'ytimg.com', 'youtube-nocookie.com'] },
  { token: 'amazon', domains: [...cc('amazon', AMAZON_CC), 'amazonaws.com', 'amazon.dev', 'a2z.com', 'amzn.to', 'media-amazon.com', 'primevideo.com', 'aboutamazon.com', 'amazonpay.com', 'amazon.jobs', 'amazon.science'] },
  { token: 'netflix', domains: ['netflix.com', 'nflxext.com', 'nflximg.net', 'netflix.net'] },
  { token: 'spotify', domains: ['spotify.com', 'spotify.link', 'scdn.co', 'spoti.fi'] },
  { token: 'adobe', domains: ['adobe.com', 'adobe.io', 'adobelogin.com', 'typekit.net'] },
  { token: 'dropbox', domains: ['dropbox.com', 'dropboxmail.com', 'dropboxusercontent.com', 'db.tt'] },
  { token: 'docusign', domains: ['docusign.com', 'docusign.net'] },
  // Link shorteners: a page named for one pretends to be a short link you can trust to forward you.
  { token: 'tinyurl', domains: ['tinyurl.com'] },
  { token: 'bitly', domains: ['bitly.com', 'bit.ly'] },
  // More of the most impersonated names (banks, posts, streaming, taxes, games). Brands that are ordinary words
  // (Discover, Target, Citizens, Chime, Vanguard) are left out: their names turn up in honest sites everywhere. So
  // are games with big fan scenes (Minecraft, Fortnite, Twitch): minecraft.wiki and the like are not imitations.
  { token: 'navyfederal', domains: ['navyfederal.org'] },
  { token: 'monzo', domains: ['monzo.com'] },
  { token: 'desjardins', domains: ['desjardins.com'] },
  { token: 'scotiabank', domains: ['scotiabank.com', 'scotiabank.ca'] },
  { token: 'tdbank', domains: ['td.com', 'tdbank.com', 'tdameritrade.com'] },
  { token: 'commbank', domains: ['commbank.com.au', 'netbank.com.au'] },
  { token: 'westpac', domains: ['westpac.com.au', 'westpac.co.nz'] },
  { token: 'schwab', domains: ['schwab.com'] },
  { token: 'etrade', domains: ['etrade.com', 'morganstanley.com'] },
  { token: 'laposte', domains: ['laposte.fr', 'laposte.net', 'labanquepostale.fr'] },
  { token: 'correos', domains: ['correos.es', 'correos.com'] },
  { token: 'postnl', domains: ['postnl.nl', 'postnl.com'] },
  { token: 'aramex', domains: ['aramex.com'] },
  { token: 'disney', domains: ['disney.com', 'disneyplus.com', 'go.com', 'disneystore.com', 'disney.co.uk', 'disneyplus.co.uk'] },
  { token: 'disneyplus', domains: ['disneyplus.com', 'disney.com'] },
  { token: 'hulu', domains: ['hulu.com'] },
  { token: 'hbomax', domains: ['hbomax.com', 'max.com', 'hbo.com'] },
  { token: 'paramountplus', domains: ['paramountplus.com', 'paramount.com'] },
  { token: 'intuit', domains: ['intuit.com', 'turbotax.com', 'quickbooks.com', 'creditkarma.com', 'mint.com'] },
  { token: 'turbotax', domains: ['turbotax.com', 'intuit.com'] },
  { token: 'quickbooks', domains: ['quickbooks.com', 'intuit.com'] },
  { token: 'etsy', domains: ['etsy.com', 'etsy.me'] },
  { token: 'xbox', domains: ['xbox.com', 'microsoft.com'] },
  { token: 'battlenet', domains: ['battle.net', 'blizzard.com'] },
  { token: 'riotgames', domains: ['riotgames.com', 'leagueoflegends.com', 'playvalorant.com'] },
  // Password managers: one stolen login opens every other account.
  { token: 'lastpass', domains: ['lastpass.com', 'lastpass.eu', 'lastpass.io'] },
  { token: 'bitwarden', domains: ['bitwarden.com', 'bitwarden.eu', 'bitwarden.net'] },
  { token: 'dashlane', domains: ['dashlane.com'] },
  { token: 'nordpass', domains: ['nordpass.com'] },
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
  { token: 'facebook', domains: ['facebook.com', 'fb.com', 'fb.me', 'fbcdn.net', 'messenger.com', 'meta.com', 'facebook.net', 'facebookmail.com'] },
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
  { token: 'shein', domains: ['shein.com', 'shein.co.uk', 'sheingroup.com'] },
  { token: 'bestbuy', domains: ['bestbuy.com', 'bestbuy.ca', 'geeksquad.com'] },
  { token: 'geeksquad', domains: ['geeksquad.com', 'bestbuy.com'] },
  { token: 'ticketmaster', domains: ['ticketmaster.com', 'ticketmaster.co.uk', 'ticketmaster.ca', 'ticketmaster.com.au', 'livenation.com'] },
  // Antivirus names: the "your subscription renewed, call for a refund" scam.
  { token: 'norton', domains: ['norton.com', 'nortonlifelock.com', 'gen.digital'] },
  { token: 'mcafee', domains: ['mcafee.com'] },
  { token: 'cloudflare', domains: ['cloudflare.com', 'cloudflare.net', 'cloudflareinsights.com', 'one.one.one.one'] },
  { token: 'costco', domains: ['costco.com', 'costco.ca', 'costco.co.uk'] },
  { token: 'dhl', domains: ['dhl.com', 'dhl.de', 'dhl.co.uk', 'dhl.fr', 'dhlparcel.nl', 'dhl.nl'] },
  { token: 'fedex', domains: ['fedex.com'] },
  { token: 'usps', domains: ['usps.com', 'usps.gov'] },
  // Toll roads: "unpaid toll" messages from look-alike E-ZPass sites are among the most common scams today.
  // Toll agencies: the "unpaid toll" text is among the most sent scams.
  { token: 'sunpass', domains: ['sunpass.com'] },
  { token: 'txtag', domains: ['txtag.org'] },
  { token: 'ezdrivema', domains: ['ezdrivema.com', 'mass.gov'] },
  { token: 'thetollroads', domains: ['thetollroads.com'] },
  { token: 'fastrak', domains: ['bayareafastrak.org', 'fastrak.org'] },
  { token: 'peachpass', domains: ['peachpass.com', 'peachpassgo.com'] },
  { token: 'ezpass', domains: ['e-zpassiag.com', 'e-zpassny.com', 'ezpassnj.com', 'ezpassva.com', 'ezpassmd.com', 'ezpassde.com', 'ezpassma.com', 'ezpassoh.com', 'ezpass.com'] },
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
  { token: 'trustwallet', domains: ['trustwallet.com'] },
  { token: 'ledger', domains: ['ledger.com', 'ledgerwallet.com'] },
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
  // imToken's real site is token.im, so its fakes are written both ways round.
  { token: 'imtoken', domains: ['token.im'] },
  { token: 'tokenim', domains: ['token.im'] },
  { token: 'epicgames', domains: ['epicgames.com', 'unrealengine.com'] },
  { token: 'playstation', domains: ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com'] },
  { token: 'nintendo', domains: ['nintendo.com', 'nintendo.net', 'nintendo.co.jp', 'nintendo.co.uk'] },

  // Government and tax
  { token: 'irs', domains: ['irs.gov'] },
  { token: 'hmrc', domains: ['gov.uk'] },
  { token: 'medicare', domains: ['medicare.gov', 'cms.gov'] },

  // Asia and enterprise sign-in: today's phishing feeds are full of them (naver.<something>.ltd, rakutenid.<...>)
  { token: 'naver', domains: ['naver.com', 'naver.net', 'navercorp.com'] },
  { token: 'kakao', domains: ['kakao.com', 'kakaocorp.com', 'daum.net', 'kakaobank.com'] },
  { token: 'rakuten', domains: ['rakuten.co.jp', 'rakuten.com', 'rakuten.ne.jp', 'rakuten-card.co.jp', 'rakuten-bank.co.jp', 'rakuten-sec.co.jp', 'rakuten.fr', 'rakuten.de', 'rakuten.tv'] },
  { token: 'okta', domains: ['okta.com', 'oktacdn.com', 'okta-emea.com', 'oktapreview.com', 'okta.dev'] },
  { token: 'aliyun', domains: ['aliyun.com', 'alibabacloud.com'] },
  { token: 'alibaba', domains: ['alibaba.com', 'alibabacloud.com', 'alibaba-inc.com', 'alibabagroup.com', '1688.com'] },
  { token: 'taobao', domains: ['taobao.com', 'tmall.com'] },
  { token: 'douyin', domains: ['douyin.com'] },
  { token: 'netease', domains: ['netease.com', '163.com', '126.com', 'yeah.net'] },
  { token: 'dingtalk', domains: ['dingtalk.com'] },
  { token: 'wechat', domains: ['wechat.com', 'qq.com', 'weixin.qq.com'] },
  { token: 'yahoo', domains: ['yahoo.com', 'yahoo.co.jp', 'yahoo.net', 'yimg.com', 'yahoo.co.uk', 'ymail.com'] },
  { token: 'docomo', domains: ['docomo.ne.jp', 'nttdocomo.co.jp', 'docomo.jp'] },
  { token: 'mercari', domains: ['mercari.com', 'mercari.jp', 'merpay.com'] },
  { token: 'autoscout24', domains: cc('autoscout24', ['com', 'de', 'be', 'it', 'fr', 'nl', 'at', 'ch', 'es', 'lu', 'pl', 'se', 'ro', 'bg', 'hr', 'cz', 'hu', 'ru', 'com.tr', 'ua']) },
  { token: 'axisbank', domains: ['axisbank.com', 'axisbank.co.in', 'axis.bank.in'] }

];

// Banks, payment services and exchanges among the brands above, and big banks with no entry of their own (a brand
// entry also drives lookalike detection, so these are only named here). One list for every place that needs to know
// "this is where money moves": the tech-support scam shield's bank warning in the Windows app.
const MONEY_TOKENS = ['paypal', 'venmo', 'zelle', 'cashapp', 'wise', 'revolut', 'chase', 'wellsfargo', 'bankofamerica', 'citibank',
  'capitalone', 'americanexpress', 'usaa', 'truist', 'santander', 'hsbc', 'barclays', 'natwest', 'lloyds', 'interac', 'mercadopago',
  'navyfederal', 'monzo', 'desjardins', 'scotiabank', 'tdbank', 'commbank', 'westpac', 'schwab', 'etrade', 'axisbank', 'coinbase', 'binance', 'kraken'];
const MONEY_DOMAINS = [...new Set([
  ...BRANDS.filter((b) => MONEY_TOKENS.includes(b.token)).flatMap((b) => b.domains),
  'usbank.com', 'pnc.com', 'citizensbank.com', 'ally.com', 'discover.com', 'regions.com', 'fidelity.com', 'vanguard.com',
  'rbcroyalbank.com', 'bmo.com', 'cibc.com', 'nationwide.co.uk', 'halifax.co.uk', 'starlingbank.com', 'anz.com.au', 'nab.com.au'
])];

module.exports = { BRANDS, MONEY_DOMAINS };
