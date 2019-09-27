const _ = require('lodash')
const axios = require('axios')
const { ProxyCrawlAPI } = require('proxycrawl')
const validator = require('validator');
const jsdom = require("jsdom")
const { JSDOM } = jsdom

const TEST_STR = 'hello i am a profile with www.twitter.com/zach github.com/zach https://github.com/zach www.zach.dev other stuff zach.dev hello@gmail.com www.clay.run/more-stuff-here also @sarasanchezgt @substack #Hashtag #iamahashtag #supercool'

// @see https://gist.github.com/dperini/729294
const regexWebsite = new RegExp(
  "^" +
  // protocol identifier (optional)
  // short syntax // still required
  "(?:(?:(?:https?|ftp):)?\\/\\/)" +
  // user:pass BasicAuth (optional)
  "(?:\\S+(?::\\S*)?@)?" +
  "(?:" +
  // IP address exclusion
  // private & local networks
  "(?!(?:10|127)(?:\\.\\d{1,3}){3})" +
  "(?!(?:169\\.254|192\\.168)(?:\\.\\d{1,3}){2})" +
  "(?!172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})" +
  // IP address dotted notation octets
  // excludes loopback network 0.0.0.0
  // excludes reserved space >= 224.0.0.0
  // excludes network & broadcast addresses
  // (first & last IP address of each class)
  "(?:[1-9]\\d?|1\\d\\d|2[01]\\d|22[0-3])" +
  "(?:\\.(?:1?\\d{1,2}|2[0-4]\\d|25[0-5])){2}" +
  "(?:\\.(?:[1-9]\\d?|1\\d\\d|2[0-4]\\d|25[0-4]))" +
  "|" +
  // host & domain names, may end with dot
  // can be replaced by a shortest alternative
  // (?![-_])(?:[-\\w\\u00a1-\\uffff]{0,63}[^-_]\\.)+
  "(?:" +
  "(?:" +
  "[a-z0-9\\u00a1-\\uffff]" +
  "[a-z0-9\\u00a1-\\uffff_-]{0,62}" +
  ")?" +
  "[a-z0-9\\u00a1-\\uffff]\\." +
  ")+" +
  // TLD identifier name, may end with dot
  "(?:[a-z\\u00a1-\\uffff]{2,}\\.?)" +
  ")" +
  // port number (optional)
  "(?::\\d{2,5})?" +
  // resource path (optional)
  "(?:[/?#]\\S*)?" +
  "$", "i"
)
const regexTwitterUrl = /(?:(?:http|https):\/\/)?(?:www\.)?twitter\.com\/([a-zA-Z0-9_]+)/g
const regexFacebookUrl = /(?:(?:http|https):\/\/)?(?:www.)?facebook.com\/?/g
const regexLinkedInUrl = /(?:(?:http|https):\/\/)?(?:www.)?linkedin.com\/?/g
const regexInstagramUrl = /(?:(?:http|https):\/\/)?(?:www.)?instagram.com\/?/g
const regexPinterestUrl = /(?:(?:http|https):\/\/)?(?:www.)?pinterest.com\/?/g
const regexTumblrUrl = /(?:(?:http|https):\/\/)?(?:www.)?tumblr.com\/?/g
const regexYoutubeUrl = /(?:(?:http|https):\/\/)?(?:www.)?youtube.com\/?/g
const regexAlibabaUrl = /(?:(?:http|https):\/\/)?(?:www.)?alibaba.com\/?/g
const regexGithubUrl = /(?:(?:http|https):\/\/)?(?:www.)?github.com\/?/g

const ALL_REGEXES = [
  { regex: regexTwitterUrl, type: 'twitter' },
  { regex: regexFacebookUrl, type: 'facebook' },
  { regex: regexLinkedInUrl, type: 'linkedin' },
  { regex: regexInstagramUrl, type: 'instagram' },
  { regex: regexPinterestUrl, type: 'pinterest' },
  { regex: regexTumblrUrl, type: 'tumblr' },
  { regex: regexYoutubeUrl, type: 'youtube' },
  { regex: regexAlibabaUrl, type: 'alibaba' },
  { regex: regexGithubUrl, type: 'github' },
]

exports.handler = scrape

async function scrape (event, done, fail) {
  const {
    url
  } = event.vars
  if (!url) return fail('Must specify url')
  if (!url.includes('http')) return fail('Must use fully-qualified url with protocol (https://url.com)')
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
  const associatedAccounts = getAssociatedAccounts(twitter.bio)
  const associatedWebsites = getAssociatedWebsites(twitter.bio)
  const relatedEntities = getRelatedEntities(twitter.bio)

  const results = {
    titles: [titleTag].concat(metaTitles),
    descriptions,
    twitter,
    associatedWebsites,
    associatedAccounts,
    relatedEntities
  }
  return results
}


function getAssociatedWebsites(text) {
  const isNotSocialMedia = url => ALL_REGEXES.every(({ regex }) => !regex.test(url))
  return textToURLs(text).filter(isNotSocialMedia).map(url => ({ url, type: 'website' }))
}

function textToURLs(text) {
  return text
    .split(' ')
    .map(str => str.trim())
    .filter(isURL)
}

function getAssociatedAccounts(text) {
  const urls = textToURLs(text)

  const matches = ALL_REGEXES.map(({ regex, type }) => {
    return urls.filter(url => regex.test(url)).map(url => ({ url, type }))
  })

  return _.flatten(matches)
}

function getRelatedEntities(text) {
  const regexTwitterAccounts = /@([a-zA-Z0-9_]+)/g
  const regexHashtags = /#[A-Za-z0-9]*/g

  const accountMatches = text.match(regexTwitterAccounts).filter(isEmail)
  const hashtagMatches = text.match(regexHashtags)

  return {
    accounts: accountMatches ? accountMatches : [],
    hashtags: hashtagMatches ? hashtagMatches : []
  }
}

// TODO: GET 3 RECENT TWEETS

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

function getMatchingMetaContent(metaTags, matches) {
  return metaTags
    .filter(metaTag => (metaTag.content && matches.indexOf(metaTag.name) >= 0))
    .map(metaTag => metaTag.content)
}

function isURL(urlStr) {
  return validator.isURL(urlStr, {
    allow_underscores: true
  })
}

function isEmail(str) {
  return validator.isEmail(str)
}
