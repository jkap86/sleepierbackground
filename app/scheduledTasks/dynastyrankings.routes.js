'use strict'

module.exports = app => {
    const dynastyrankings = require("../controllers/dynastyrankings.controller.js");

    var router = require("express").Router();

    dynastyrankings.updateDaily(app)

    app.use('/dynastyrankings', router);
}