'use strict'

module.exports = (sequelize, Sequelize, user_league) => {
    const League = sequelize.define("league", {
        league_id: {
            type: Sequelize.STRING,
            allowNull: false,
            primaryKey: true
        },
        name: {
            type: Sequelize.STRING
        },
        avatar: {
            type: Sequelize.STRING
        },
        season: {
            type: Sequelize.STRING
        },
        settings: {
            type: Sequelize.JSONB
        },
        scoring_settings: {
            type: Sequelize.JSONB
        },
        roster_positions: {
            type: Sequelize.JSONB
        },
        rosters: {
            type: Sequelize.JSONB
        },
        drafts: {
            type: Sequelize.JSONB
        },
        ...Object.fromEntries(Array.from(Array(18).keys()).map(key => {
            return [`matchups_${key + 1}`, { type: Sequelize.JSONB }]
        }))
    }, {
        indexes: [
            {
                fields: ['league_id']
            }
        ],
    });

    return League;
};
