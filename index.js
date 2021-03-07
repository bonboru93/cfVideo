#!/usr/bin/env node

'use strict'

const http = require('http')
const axios = require('axios')
const axiosRetry = require('axios-retry')
axiosRetry(axios, {
    retries: 5,
    retryCondition: () => true
})

const CONCURRENCY_LEVEL = 5
const CHUNK_SIZE = 2 * 1024 * 1024

let rangeMax = {}
const getRangeMax = async videoUrl => {
    const rspRange = (await axios(videoUrl, { headers: { range: 'bytes=0-1' } })).headers['content-range']
    return rspRange.substring(rspRange.indexOf('/') + 1)
}

http.createServer(async (req, rsp) => {
    const reqUrl = req.url.substring(1).replace('https', 'http')

    const reqRange = req.headers.range
    const reqRangeBegin = Number(reqRange.substring(reqRange.indexOf('=') + 1, reqRange.indexOf('-')))
    rangeMax[reqUrl] = rangeMax[reqUrl] || await getRangeMax(reqUrl)
    const reqRangeMax = rangeMax[reqUrl]

    const rangePairs = []
    for (let i = 0; i < CONCURRENCY_LEVEL; i++) {
        const rangeBegin = reqRangeBegin + i * CHUNK_SIZE
        if (rangeBegin > reqRangeMax) break
        const rangeEnd = Math.min(rangeBegin + CHUNK_SIZE - 1, reqRangeMax)
        rangePairs.push([rangeBegin, rangeEnd])
    }

    const fetchingStartTime = Date.now()
    const videoContentPart = (await Promise.all(rangePairs.map(([rangeBegin, rangeEnd]) =>
        axios(reqUrl, {
            responseType: 'arraybuffer',
            headers: {
                range: `bytes=${rangeBegin}-${rangeEnd}`
            }
        })
    ))).map(rsp => rsp.data)
    const videoContent = Buffer.concat(videoContentPart)

    rsp.writeHead(206, {
        'Content-Length': videoContent.length,
        'Content-Range': `bytes ${reqRangeBegin}-${reqRangeBegin + videoContent.length - 1}/${reqRangeMax}`
    })
    rsp.end(videoContent)

    console.log(`${new Date().toLocaleString()} [${decodeURI(reqUrl.substring(reqUrl.lastIndexOf('/') + 1))}] ${videoContent.length / 1024 / 1024 / (Date.now() - fetchingStartTime) * 1000} MB/s`)
}).listen(61234)

setInterval(() => {
    rangeMax = {}
}, 6 * 60 * 60 * 1000)
