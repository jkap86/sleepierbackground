'use strict';

const db = require("../models");
const User = db.users;
const League = db.leagues;
const Op = db.Sequelize.Op;
const axios = require('../api/axiosInstance');

exports.user = async (app) => {
    app.set('syncing', false)
    console.log('Beginning User Sync...')

    const league_ids_queue = app.get('league_ids_queue')

    console.log(`${league_ids_queue.length} Leagues from queue...`)

    const state = app.get('state')

    try {
        // Get User_ids to update

        const lm_leagues_cutoff = app.get('lm_leagues_cutoff');
        app.set('lm_leagues_cutoff', new Date());

        let new_users_to_update = await User.findAll({
            order: [['updatedAt', 'ASC']],
            attributes: ['user_id'],
            where: {
                [Op.and]: [
                    {
                        type: ['LM', 'S']
                    },
                    {
                        [Op.or]: [
                            {
                                updatedAt: {
                                    [Op.lt]: new Date(new Date() - 6 * 60 * 60 * 1000)
                                }
                            },
                            {
                                createdAt: {
                                    [Op.gt]: lm_leagues_cutoff
                                }
                            }
                        ]
                    }

                ]
            },
            raw: true
        })

        console.log(`checking ${new_users_to_update.length} users...`)
        await User.bulkCreate(
            new_users_to_update.map(user => {
                return {
                    user_id: user.user_id,
                    updatedAt: new Date()
                }
            }),
            { updateOnDuplicate: ['updatedAt'] }
        )

        // Get League_ids to update

        let league_ids_to_check = [];

        const batchSize = 10;

        for (let i = 0; i < new_users_to_update.length; i += batchSize) {
            const batch = new_users_to_update.slice(i, i + batchSize);

            const batchResults = await Promise.all(
                batch.map(async user => {
                    const leagues = await axios.get(`http://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${state.league_season}`)

                    return leagues.data.map(league => league.league_id);
                })
            )

            league_ids_to_check.push(...batchResults)
        }
        league_ids_to_check = Array.from(new Set(league_ids_to_check.flat()));

        console.log(league_ids_to_check[0])

        console.log(`${league_ids_to_check.length} League Ids to check...`)
        const leagues_db = await League.findAll({
            attributes: ['league_id'],
            where: {
                league_id: league_ids_to_check
            },
            raw: true
        })

        console.log({ league_ids_to_check: league_ids_to_check.length })

        const new_league_ids = league_ids_to_check
            .filter(
                league_id => !leagues_db.find(league => league.league_id === league_id)
            );

        console.log(`${new_league_ids.length} new Leagues added to queue...`)

        app.set('league_ids_queue', [...league_ids_queue, ...new_league_ids])
    } catch (error) {
        console.log(error.message)
    }
    console.log('User Sync Complete')
}