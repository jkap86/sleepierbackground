'use strict';

const db = require("../models");
const User = db.users;
const League = db.leagues;
const Op = db.Sequelize.Op;
const axios = require('../api/axiosInstance');
const allplayers = require('../../allplayers.json');

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
            limit: 250,
            attributes: ['user_id'],
            where: {
                [Op.and]: [
                    {
                        type: ['LM', 'S']
                    },
                    {
                        updatedAt: {
                            [Op.lt]: new Date(new Date() - 25 * 60 * 1000)
                        }
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
                    && !league_ids_queue.includes(league_id)
            );

        console.log(`${new_league_ids.length} new Leagues added to queue...`)

        app.set('league_ids_queue', [...league_ids_queue, ...new_league_ids])
    } catch (error) {
        console.log(error.message)
    }
    console.log('User Sync Complete')
}


exports.playershares = async (app) => {
    console.log('Beginning playershares sync...')
    try {
        const users_to_update = await User.findAll({
            order: [['playershares_update', 'ASC']],
            limit: 25,
            attributes: ['user_id', 'playershares_update'],
            where: {
                [Op.and]: [
                    {
                        type: ['LM', 'S']
                    },
                    {
                        playershares_update: {
                            [Op.or]: [
                                { [Op.eq]: null },
                                { [Op.lt]: new Date(new Date() - 6 * 60 * 60 * 1000) }
                            ]
                        }

                    }
                ]
            },
            include: {
                model: League,
                through: { attributes: [] },
                attributes: ['settings', 'rosters']
            }
        })

        console.log(users_to_update.length + ' User Playershares to update')

        const user_playershares = [];

        users_to_update
            .forEach(user => {
                const players_dict = {}

                Object.keys(allplayers)
                    .forEach(player_id => {
                        const player_leagues = user.dataValues.leagues
                            .filter(l => l.rosters
                                .find(r => r.user_id === user.dataValues.user_id && r.players?.includes(player_id))
                            )

                        if (player_leagues.length > 0) {
                            const r_b = player_leagues.filter(l => l.settings.type !== 2 && l.settings.best_ball === 1).length;
                            const r_b_total = user.dataValues.leagues.filter(l => l.settings.type !== 2 && l.settings.best_ball === 1).length;

                            const r_s = player_leagues.filter(l => l.settings.type !== 2 && l.settings.best_ball !== 1).length;
                            const r_s_total = user.dataValues.leagues.filter(l => l.settings.type !== 2 && l.settings.best_ball !== 1).length;

                            const d_b = player_leagues.filter(l => l.settings.type === 2 && l.settings.best_ball === 1).length;
                            const d_b_total = user.dataValues.leagues.filter(l => l.settings.type === 2 && l.settings.best_ball === 1).length;

                            const d_s = player_leagues.filter(l => l.settings.type === 2 && l.settings.best_ball !== 1).length;
                            const d_s_total = user.dataValues.leagues.filter(l => l.settings.type === 2 && l.settings.best_ball !== 1).length;


                            players_dict[player_id] = {
                                r_b: [r_b, r_b_total],
                                r_s: [r_s, r_s_total],
                                d_b: [d_b, d_b_total],
                                d_s: [d_s, d_s_total],
                                all: [player_leagues.length, user.dataValues.leagues.length]
                            };
                        }
                    })

                user_playershares.push({ user_id: user.dataValues.user_id, playershares: players_dict, playershares_update: new Date() })
            })

        console.log('playershares updated for ' + user_playershares.length + ' Users')
        await User.bulkCreate(user_playershares, { updateOnDuplicate: ['playershares', 'playershares_update'] })
    } catch (error) {
        console.log(error)
    }
    console.log('Playershares sync complete...')
}