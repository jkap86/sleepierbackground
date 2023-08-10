'use strict'

module.exports = app => {
    const boot = require('../../app/controllers/boot.controller.js');

    boot.boot(app)


    const now = new Date();



    let utc = new Date(now);

    utc.setUTCHours(8, 0, 0, 0);

    const delay = now - utc;

    if (delay > 0) {
        setTimeout(() => {
            setInterval(() => {
                boot.boot(app)
            }, 24 * 60 * 60 * 1000)
        }, delay);
    } else {
        setTimeout(() => {
            setInterval(() => {
                boot.boot(app)
            }, 24 * 60 * 60 * 1000)
        }, delay + (24 * 60 * 60 * 1000));
    }
}