const https = require('https');
const axios = require('axios');

const axiosInstance = axios.create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: 3000
});

const axiosRetry = require('axios-retry');

axiosRetry(axiosInstance, {
    retries: 5, retryDelay: (retryNumber) => {
        return 2000 + (retryNumber * 1000)
    }
})

module.exports = axiosInstance;