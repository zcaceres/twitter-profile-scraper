const _ = require('lodash')
const axios = require('axios')
const { ProxyCrawlAPI } = require('proxycrawl')
const validator = require('validator');
const jsdom = require("jsdom")
const { JSDOM } = jsdom

exports.handler = scrape

scrape({ vars: { url: 'https://twitter.com/zachcaceres' } }, console.log, console.error)

async function scrape (event, done, fail) {
  const {
    url
  } = event.vars
  if (!url) return fail('Must specify url')
  try {
    const res = await axios.get(url)
    const dom = toJSDOM(res.data)
    done(analyze(dom))
  } catch (e) {
    console.log(e)
    fail(e)
  }
}

function analyze(bodyDOM) {
  const titleTag = getTitleTag(bodyDOM)
  const headScripts = getHeadScripts(bodyDOM)
  const jsonld = getJsonldFromScripts(headScripts)
  const meta = getMetaTagsFromBody(bodyDOM)
  const metaTitles = getTitleFromMeta(meta)
  const descriptions = [
    ...getDescriptionFromJSONLD(jsonld),
    ...getTypesFromJSONLD(jsonld),
    ...getDescriptionFromMeta(meta)
  ]
  const twitter = getTwitterData(bodyDOM)

  const results = {
    titles: [titleTag].concat(metaTitles),
    descriptions,
    twitter,
    associatedAccounts: [],
    relatedEntities: [],
  }
  return results
}

function toJSDOM(responseBody) {
  return new JSDOM(responseBody);
}

function getTwitterData(bodyDOM) {
  const body = bodyDOM.window.document.body
  return {
    photo: body.querySelector('.ProfileAvatar-image').src,
    bio: body.querySelector('.ProfileHeaderCard-bio').textContent.trim(),
    name: body.querySelector('.ProfileHeaderCard-nameLink').textContent.trim(),
    username: body.querySelector('.ProfileHeaderCard-screennameLink').textContent.trim(),
    location: body.querySelector('.ProfileHeaderCard-locationText').textContent.trim(),
    website: body.querySelector('.ProfileHeaderCard-url').textContent.trim(),
    joinedDate: body.querySelector('.ProfileHeaderCard-joinDateText').textContent.trim(),
    tweetCount: Number(body.querySelector('.ProfileNav-item--tweets .ProfileNav-value').dataset.count),
    followingCount: Number(body.querySelector('.ProfileNav-item--following .ProfileNav-value').dataset.count),
    followerCount: Number(body.querySelector('.ProfileNav-item--followers .ProfileNav-value').dataset.count),
    likesCount: Number(body.querySelector('.ProfileNav-item--favorites .ProfileNav-value').dataset.count)
  }
}

function getAllScripts(bodyDOM) {
  const head = nodeListToArray(bodyDOM.window.document.head.querySelectorAll('script'));
  const body = nodeListToArray(bodyDOM.window.document.body.querySelectorAll('script'));
  const footer = bodyDOM.window.document.querySelector('footer');
  let footerScripts = [];
  if (footer) footerScripts = footerScripts.concat(nodeListToArray(footer.querySelectorAll('script')));
  return [...head, ...body, ...footerScripts];
}

function nodeListToArray(nl) {
  return Array.from(nl)
}

function getTitleTag(bodyDOM) {
  const titleTag = getElementsByTagName(bodyDOM, 'title')[0]
  return (titleTag ? titleTag.text : '').trim()
}

function getHeadScripts(bodyDOM) {
  return nodeListToArray(bodyDOM.window.document.head.querySelectorAll('script'))
}

function getJsonldFromScripts(scripts) {
  return scripts.filter(sc => sc.type === 'application/ld+json')
    .map((el) => {
      try {
        return JSON.parse(el.text.trim())
      } catch (e) {
        return null
      }
    }).filter(script => script)
}

function getMetaTagsFromBody(bodyDOM) {
  const metaTags = getMetaTags(bodyDOM)
  return metaTags.filter(isUsefulMetaTag).map((metaTag) => {
    var pickName = metaTag.getAttribute('itemprop') || metaTag.getAttribute('property') || metaTag.getAttribute('name')
    return {
      name: pickName,
      content: metaTag.content
    }
  })
}

function isUsefulMetaTag(metaTag) {
  return metaTag.getAttribute('itemprop') || metaTag.getAttribute('name') || metaTag.getAttribute('property');
}

function getMetaTags(bodyDOM) {
  return nodeListToArray(bodyDOM.window.document.head.querySelectorAll('meta'))
}

function getMailToAnchorTags(bodyDOM) {
  const anchors = getElementsByTagName(bodyDOM, 'a')
  return anchors.filter(anchor => anchor.href && anchor.href.includes('mailto:')).map(anchor => stripMailto(anchor.href))
}

function getElementsByTagName(bodyDOM, tagName) {
  return nodeListToArray(bodyDOM.window.document.querySelectorAll(tagName))
}

function getTitleFromMeta(metaTags) {
  return getMatchingMetaContent(metaTags, ['og:site_name', 'og:title', 'twitter:title'])
}

function getDescriptionFromJSONLD(jsonld) {
  return jsonld.filter(entry => entry.description && typeof entry.description === 'string').map(entry => entry.description.trim())
}

function getTypesFromJSONLD(jsonld) {
  return jsonld.filter(entry => entry['@type'] && typeof entry['@type'] === 'string').map(entry => entry['@type'].trim())
}

function getDescriptionFromMeta(metaTags) {
  return getMatchingMetaContent(metaTags, ['description', 'og:description', 'twitter:description', 'keywords'])
}

function getCompanyNames(jsonld, titles, metaTitles) {
  var companyNames = titles.slice()
    .concat(getLegalName(jsonld))
    .concat(getPublicName(jsonld))
    .concat(getAlternateName(jsonld))
  return companyNames
}

function getLegalName(jsonld) {
  return jsonld.filter(entry => entry.legalName && typeof entry.legalName === 'string').map(entry => entry.legalName.trim())
}

function getAlternateName(jsonld) {
  return jsonld.filter(entry => entry.alternateName && typeof entry.alternateName === 'string').map(entry => entry.alternateName.trim())
}

function getPublicName(jsonld) {
  return jsonld.filter(entry => entry.name && typeof entry.name === 'string').map(entry => entry.name.trim())
}

function getBodyText(bodyDOM) {
  return bodyDOM.window.document.body.textContent
}

function isGoodCompanyName(companyName) {
  return companyName && ['your site title', 'home', 'squarespace', 'wordpress', 'shopify'].indexOf(companyName.toLowerCase()) === -1
}

function getPhones(jsonld) {
  const phonesArr = [].concat(jsonld.filter(entry => entry.telephone && typeof entry.telephone === 'string').map(entry => entry.telephone.trim()))
  return phonesArr
}

function getAddress(jsonld) {
  var address = {}
  var street
  var city
  var state
  var zip
  var country
  var addressJsonlds = jsonld.filter(entry => entry.address)
  var addrStr = addressJsonlds.filter(entry => typeof entry.address === 'string').map(entry => entry.address.trim())[0]
  if (addrStr) {
    street = addrStr.replace(/\s/g, ' ').trim() || street
  } else {
    street = addressJsonlds.map(entry => entry.address.streetAddress)[0] || street
    city = addressJsonlds.map(entry => entry.address.addressLocality)[0] || city
    state = addressJsonlds.map(entry => entry.address.addressRegion)[0] || state
    zip = addressJsonlds.map(entry => entry.address.postalCode)[0] || zip
    country = addressJsonlds.map(entry => entry.address.addressCountry)[0] || country
  }
  if (street && street.trim && street.trim()) address.street = street.trim()
  if (city && city.trim && city.trim()) address.city = city.trim()
  if (state && state.trim && state.trim()) address.state = state.trim()
  if (zip && zip.trim && zip.trim()) address.zip = zip.trim()
  if (country && country.trim && country.trim()) address.country = country.trim()
  return address
}

function getSocialMedia(metaTags, jsonld) {
  const socialObj = {}
  const twitterName = getMatchingMetaContent(metaTags, ['twitter:site', 'twitter:creator'])[0]
  if (twitterName) socialObj.twitter = twitterName
  _.assign(socialObj, getSameAsProfiles(jsonld))
  return socialObj
}

// TODO: look in body data for any img tag with class, alt or id that contains 'logo' or alt that is the company name
function getLogoUrl(metaTags, jsonld) {
  const logosArr = jsonld.filter(entry => entry.logo && typeof entry.logo === 'string').map(entry => entry.logo.trim())
    .concat(metaTags.filter(meta => meta.name === 'og:image').map(meta => meta.content))
  return logosArr.map(fixLogoUrl).filter(isURL) || []
}

function fixLogoUrl(urlStr) {
  var toReturn = urlStr.slice()
  if (toReturn.indexOf('//') === 0) toReturn = 'https:' + toReturn
  return toReturn
}

function getSameAsProfiles(jsonld) {
  var sameAsArr = _.flatten(jsonld.filter(entry => entry.sameAs && entry.sameAs === 'string').map(entry => entry.sameAs.trim()))
  var profilesFound = {}
  sameAsArr.forEach(function (sameAs) {
    if (sameAs.includes('facebook.com')) profilesFound.facebook = sameAs
    else if (sameAs.includes('github.com')) profilesFound.github = sameAs
    else if (sameAs.includes('google.com')) profilesFound.google = sameAs
    else if (sameAs.includes('instagram.com')) profilesFound.instagram = sameAs
    else if (sameAs.includes('linkedin.com')) profilesFound.linkedin = sameAs
    else if (sameAs.includes('pinterest.com')) profilesFound.pinterest = sameAs
    else if (sameAs.includes('twitter.com')) profilesFound.twitter = sameAs
    else if (sameAs.includes('vimeo.com')) profilesFound.vimeo = sameAs
    else if (sameAs.includes('youtube.com')) profilesFound.youtube = sameAs
  })
  return profilesFound
}

function getMatchingMetaContent(metaTags, matches) {
  return metaTags
    .filter(metaTag => (metaTag.content && matches.indexOf(metaTag.name) >= 0))
    .map(metaTag => metaTag.content);
}

function isURL(urlStr) {
  return validator.isURL(urlStr, {
    allow_underscores: true
  });
}

function getJSONLDContacts(jsonld) {
  return jsonld.filter(entry => entry.email && typeof entry.email === 'string').map(function (entry) {
    return {
      email: stripMailto(entry.email),
      source: 'scraper'
    };
  });
}

function stripMailto(str) {
  return (str || '').replace('mailto:', '');
}

function getMailToAnchorTags(bodyDOM) {
  const anchors = getElementsByTagName(bodyDOM, 'a');
  return anchors.filter(anchor => anchor.href && anchor.href.includes('mailto:')).map(anchor => stripMailto(anchor.href));
}

function nodeListToArray(nl) {
  return Array.from(nl)
}
