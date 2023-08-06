'use strict'

const db = require("../models");
const axios = require('../api/axiosInstance');
const fs = require('fs');

exports.boot = async (app) => {
    const getAllPlayers = async () => {
        //  get allplayers dict - from .json file in dev; filter for active and position

        let sleeper_players;
        if (process.env.DATABASE_URL) {
            try {
                sleeper_players = await axios.get('https://api.sleeper.app/v1/players/nfl')

                sleeper_players = Object.fromEntries(Object.keys(sleeper_players.data)
                    .filter(player_id => sleeper_players.data[player_id].active && ['QB', 'RB', 'FB', 'WR', 'TE', 'K'].includes(sleeper_players.data[player_id].position))
                    .map(key => {
                        const { position, college, number, birth_date, age, full_name, active, team, player_id, search_full_name, years_exp } = sleeper_players.data[key];
                        return [
                            key,
                            {
                                position,
                                college,
                                number,
                                birth_date,
                                age,
                                full_name,
                                active,
                                team,
                                player_id,
                                search_full_name,
                                years_exp
                            }
                        ]
                    }
                    ))

                fs.writeFileSync('./allplayers.json', JSON.stringify(sleeper_players))

            } catch (error) {
                console.log(error)
            }
        }
    }

    app.set('lm_leagues_cutoff', new Date());

    app.set('league_ids_queue', []);

    app.set('syncing', 'userLeagues');

    app.set('trades_sync_counter', 0);

    if (process.env.DATABASE_URL) {
        getAllPlayers();
    }

    const getState = async () => {
        const state = await axios.get('https://api.sleeper.app/v1/state/nfl')

        app.set('state', {
            ...state.data,
            display_week: Math.max(state.data.display_week, 1)
        }, 0)
    }

    getState();


}