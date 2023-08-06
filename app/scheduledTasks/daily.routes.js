'use strict'

module.exports = app => {
    const boot = require('../../app/controllers/boot.controller.js');

    boot.boot(app)


    const now = new Date();

    let utc = new Date(now);

    utc.setUTCHours(8, 0, 0, 0);

    const delay = now - utc;


    setInterval(() => {
        boot.boot(app)
    }, delay)

}