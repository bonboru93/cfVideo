#!/usr/bin/env node

'use strict'

const http = require('http')
const axios = require('axios')
const axiosRetry = require('axios-retry')
axiosRetry(axios, {
    retries: 5,
    retryCondition: () => true,
    retryDelay: axiosRetry.exponentialDelay
})

// ===== global begin =====
const SERVER_ADDR = 'localhost'
const SERVER_PORT = 61234

let concurrencyLevel = 15
let chunkSize = 2 * 1024 * 1024

const sleep = second => new Promise(resolve => setTimeout(resolve, second * 1000))

const httpAgent = new http.Agent({ keepAlive: true })

let videoInfo = {}

setInterval(() => {
    httpAgent.destroy()
    videoInfo = {}
    console.log(`${new Date().toLocaleString()} cache cleaned`)
}, 6 * 60 * 60 * 1000)
// ===== global end =====

const handleSetting = (req, rsp) => {
    if (req.url.length) {
        let [newConcurrencyLevel, newChunkSize] = req.url.split(',')
        concurrencyLevel = Number(newConcurrencyLevel) || concurrencyLevel
        newChunkSize = Number(newChunkSize) * 1024 * 1024
        chunkSize = newChunkSize || chunkSize
        console.log(`${new Date().toLocaleString()} concurrencyLevel = ${concurrencyLevel}, chunkSize = ${chunkSize}`)
    }
    rsp.end(`concurrencyLevel = ${concurrencyLevel}, chunkSize = ${chunkSize}`)
}

const getVideoInfo = async videoUrl => {
    const rsp = await axios.get(videoUrl, {
        httpAgent,
        headers: { range: 'bytes=0-1' }
    })
    const range = rsp.headers['content-range']
    const size = Number(range.substring(range.indexOf('/') + 1))
    const format = rsp.headers['content-type']
    return { size, format }
}

const handleVideo = async (req, rsp) => {
    const reqUrl = req.url.replace('https', 'http')
    console.log(`${new Date().toLocaleString()} ${req.socket.remoteAddress}:${req.socket.remotePort} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] started`)

    const reqRange = req.headers.range || '=0-'
    let reqRangeBegin = Number(reqRange.substring(reqRange.indexOf('=') + 1, reqRange.indexOf('-')))
    videoInfo[reqUrl] = videoInfo[reqUrl] || await getVideoInfo(reqUrl).catch(() => null)
    const reqVideoInfo = videoInfo[reqUrl]
    if (!reqVideoInfo) {
        rsp.writeHead(404)
        rsp.end()
        console.log(`${new Date().toLocaleString()} ${req.socket.remoteAddress}:${req.socket.remotePort} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] video info error`)
        return
    }

    rsp.writeHead(206, {
        'Content-Type': reqVideoInfo.format,
        'Content-Length': reqVideoInfo.size - reqRangeBegin,
        'Content-Range': `bytes ${reqRangeBegin}-${reqVideoInfo.size - 1}/${reqVideoInfo.size}`
    })

    while (reqRangeBegin < reqVideoInfo.size) {
        const rangePairs = []
        for (let i = 0; i < concurrencyLevel; i++) {
            if (reqRangeBegin >= reqVideoInfo.size) break
            const reqRangeEnd = Math.min(reqRangeBegin + chunkSize - 1, reqVideoInfo.size - 1)
            rangePairs.push([reqRangeBegin, reqRangeEnd])
            reqRangeBegin += chunkSize
        }

        const fetchingStartTime = Date.now()
        const videoContentPartReq = Promise.all(rangePairs.map(([rangeBegin, rangeEnd]) =>
            axios.get(reqUrl, {
                httpAgent,
                responseType: 'arraybuffer',
                headers: { range: `bytes=${rangeBegin}-${rangeEnd}` },
            }).then(rsp => rsp.data)
        )).catch(() => null)
        const videoContentPart = await Promise.race([videoContentPartReq, sleep(60)])
        if (!videoContentPart) {
            rsp.end()
            console.log(`${new Date().toLocaleString()} ${req.socket.remoteAddress}:${req.socket.remotePort} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] chunk feching error`)
            return
        }
        const videoContent = Buffer.concat(videoContentPart)

        if (req.isDead) {
            rsp.end()
            console.log(`${new Date().toLocaleString()} ${req.socket.remoteAddress}:${req.socket.remotePort} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] client closed`)
            return
        }

        rsp.write(videoContent)
        console.log(`${new Date().toLocaleString()} ${req.socket.remoteAddress}:${req.socket.remotePort} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] ${(videoContent.length / 1024 / 1024 / (Date.now() - fetchingStartTime) * 1000).toFixed(2)} MB/s`)
    }

    rsp.end()
    console.log(`${new Date().toLocaleString()} ${req.socket.remoteAddress}:${req.socket.remotePort} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] data end`)
}

http.createServer((req, rsp) => {
    if (req.url.indexOf('/setting?') === 0) {
        req.url = req.url.substring('/setting?'.length)
        handleSetting(req, rsp)
    }
    else if (req.url.indexOf('/video?') === 0) {
        req.url = req.url.substring('/video?'.length)
        handleVideo(req, rsp)
    }
    else {
        rsp.writeHead(404)
        rsp.end()
    }

    req.on('close', () => req.isDead = true)

}).listen(SERVER_PORT, SERVER_ADDR)
console.log(`${new Date().toLocaleString()} server listen at ${SERVER_ADDR}:${SERVER_PORT}`)
