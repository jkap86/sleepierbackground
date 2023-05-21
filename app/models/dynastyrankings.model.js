'use strict'

const { DataTypes } = require("sequelize");

module.exports = (sequelize, Sequelize) => {

    const DynastyRankings = sequelize.define("dynastyrankings", {

        date: {
            type: Sequelize.DATEONLY,
            primaryKey: true,
        },
        values: {
            type: Sequelize.JSONB
        }
    });

    const Stats = sequelize.define("stats", {
        season: {
            type: Sequelize.STRING,
            primaryKey: true
        },
        week: {
            type: Sequelize.INTEGER,
            primaryKey: true
        },
        player_id: {
            type: Sequelize.STRING,
            primaryKey: true
        },
        team: {
            type: Sequelize.STRING
        },
        opponent: {
            type: Sequelize.STRING
        },
        date: {
            type: Sequelize.STRING
        },
        stats: {
            type: Sequelize.JSONB
        }
    })


    return {
        DynastyRankings: DynastyRankings,
        Stats: Stats
    };
}