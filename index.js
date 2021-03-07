'use strict'

const http = require('http')
const axios = require('axios')
const axiosRetry = require('axios-retry')
axiosRetry(axios, {
    retries: 5,
    retryCondition: () => true
})

const VIDEO_PATH = process.argv[2]
const CONCURRENCY_LEVEL = 5
const CHUNK_SIZE = 2 * 1024 * 1024

let RANGE_MAX
const getRangeMax = async () => {
    const rspRange = (await axios(VIDEO_PATH, { headers: { range: 'bytes=0-1' } })).headers['content-range']
    RANGE_MAX = rspRange.substring(rspRange.indexOf('/') + 1)
    console.log('range max:', RANGE_MAX)
}

const startServer = () =>
    http.createServer(async (req, rsp) => {
        console.log('-----')
        const reqRange = req.headers.range
        const reqRangeBegin = Number(reqRange.substring(reqRange.indexOf('=') + 1, reqRange.indexOf('-')))
        console.log(`pos: ${reqRangeBegin / RANGE_MAX}`)

        const rangePair = []
        for (let i = 0; i < CONCURRENCY_LEVEL; i++) {
            const rangeBegin = reqRangeBegin + i * CHUNK_SIZE
            if (rangeBegin > RANGE_MAX) break
            const rangeEnd = Math.min(rangeBegin + CHUNK_SIZE - 1, RANGE_MAX)
            rangePair.push([rangeBegin, rangeEnd])
        }
        const fetchingStartTime = Date.now()
        const videoContentPart = (await Promise.all(rangePair.map(([rangeBegin, rangeEnd]) =>
            axios(VIDEO_PATH, {
                responseType: 'arraybuffer',
                headers: {
                    range: `bytes=${rangeBegin}-${rangeEnd}`
                }
            })
        ))).map(rsp => rsp.data)
        const videoContent = Buffer.concat(videoContentPart)
        console.log(`speed: ${videoContent.length / 1024 / 1024 / (Date.now() - fetchingStartTime) * 1000} MB/s`)

        rsp.writeHead(206, {
            'Content-Length': videoContent.length,
            'Content-Range': `bytes ${reqRangeBegin}-${reqRangeBegin + videoContent.length - 1}/${RANGE_MAX}`
        })
        rsp.end(videoContent)
    }).listen(3000)

const runIINA = () => require('child_process').exec('iina http://localhost:3000')

const main = async () => {
    await getRangeMax()
    startServer()
    runIINA()
}

main()
