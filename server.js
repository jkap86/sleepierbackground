'use strict'

const throng = require('throng');
const https = require("https");
const WORKERS = process.env.WEB_CONCURRENCY || 1;


setInterval(() => {
    https.get('https://sleepiertest.herokuapp.com/')
}, 29 * 60 * 1000);

throng({
    worker: start,
    count: WORKERS
});

function start() {
    const express = require('express');
    const cors = require('cors');
    const path = require('path');

    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.resolve(__dirname, '../client/build')));


    const db = require("./app/models");
    db.sequelize.sync({ alter: true })
        .then(() => {
            console.log("Synced db.");
        })
        .catch((err) => {
            console.log("Failed to sync db: " + err.message);
        })



    //  require('./app/scheduledTasks/sync.routes')(app)
    //  require('./app/scheduledTasks/dynastyrankings.routes')(app)

    require('./app/scheduledTasks/daily.routes')(app);
    require('./app/scheduledTasks/userLeagues.routes')(app);

    app.get('/', (req, res) => {
        res.send('ping')
    })

    app.get('*', async (req, res) => {
        res.sendFile(path.join(__dirname, '../client/build/index.html'));
    })

    const PORT = process.env.PORT || 5001;
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}.`);

    });

}