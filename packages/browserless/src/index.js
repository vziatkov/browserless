'use strict'

const debug = require('debug-logfmt')('browserless:goto')
const devices = require('@browserless/devices')
const requireOneOf = require('require-one-of')
const goto = require('@browserless/goto')
const pTimeout = require('p-timeout')
const fkill = require('fkill')
const del = require('del')

const EVALUATE_TEXT = page => page.evaluate(() => document.body.innerText)

const EVALUATE_HTML = page => page.content()

const killBrowser = async browser => {
  await browser.close()
  const pid = browser.process().pid
  await fkill(pid)
  const deletedPaths = await del(['/tmp/core.chromium.*', '/tmp/puppeteer_dev_profile*'])
  debug('killBrowser', { pid, deletedPaths })
}

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  incognito = false,
  timeout = 30000,
  ...launchOpts
} = {}) => {
  let browser

  const respawnBrowser = async () => {
    await killBrowser()
    spawnBrowser()
  }

  const spawnBrowser = async () => {
    browser = await puppeteer.launch({
      ignoreHTTPSErrors: true,
      args: [
        '--disable-notifications',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-offer-upload-credit-cards',
        '--disable-setuid-sandbox',
        '--enable-async-dns',
        '--enable-simple-cache-backend',
        '--enable-tcp-fast-open',
        '--media-cache-size=33554432',
        '--no-default-browser-check',
        '--no-pings',
        '--no-sandbox',
        '--no-zygote',
        '--prerender-from-omnibox=disabled'
      ],
      ...launchOpts
    })

    browser.on('disconnected', respawnBrowser)

    return browser
  }

  browser = spawnBrowser()

  const createPage = () =>
    Promise.resolve(browser).then(async browser => {
      const context = incognito ? await browser.createIncognitoBrowserContext() : browser
      const page = await context.newPage()
      page.setDefaultNavigationTimeout(timeout)
      return page
    })

  const wrapError = fn => async (...args) => {
    const page = await createPage()
    let error
    let res

    try {
      res = await pTimeout(fn(page)(...args), timeout)
    } catch (err) {
      error = err
    }

    await page.close()
    if (error) throw error
    return res
  }

  const evaluate = fn =>
    wrapError(page => async (url, opts = {}) => {
      const response = await goto(page, { url, ...opts })
      return fn(page, response)
    })

  const pdf = wrapError(require('@browserless/pdf'))

  const screenshot = wrapError(require('@browserless/screenshot'))

  return {
    respawnBrowser,
    browser,
    html: evaluate(EVALUATE_HTML),
    text: evaluate(EVALUATE_TEXT),
    evaluate,
    pdf,
    screenshot,
    page: createPage,
    goto
  }
}

module.exports.devices = devices
