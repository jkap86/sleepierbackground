'use strict'
const db = require("../models");
const User = db.users;
const League = db.leagues;
const Trade = db.trades;
const Op = db.Sequelize.Op;

const axios = require('../api/axiosInstance');
const ALLPLAYERS = require('../../allplayers.json');



exports.boot = async (app) => {
    const getAllPlayers = async () => {
        let sleeper_players;
        if (process.env.DATABASE_URL) {
            try {
                sleeper_players = await axios.get('https://api.sleeper.app/v1/players/nfl')
                sleeper_players = sleeper_players.data

            } catch (error) {
                console.log(error)
            }
        } else {
            console.log('getting allplayers from file...')

            sleeper_players = ALLPLAYERS
        }


        return sleeper_players
    }
    const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
    const allplayers = await getAllPlayers()

    app.set('state', state.data)
    app.set('allplayers', allplayers)

    app.set('syncing', 'lm')

    app.set('trades_sync_counter', 0)

    app.set('users_to_update', [])

    app.set('leagues_to_add', [])

    app.set('leagues_to_update', [])

    app.set('lm_leagues_cutoff', new Date(new Date() - 60 * 60 * 1000))

    setInterval(async () => {
        const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
        const allplayers = await getAllPlayers()

        app.set('state', state.data)
        app.set('allplayers', allplayers)
    }, 12 * 60 * 60 * 1000)
}

exports.trades = async (app) => {

    let interval = 1 * 60 * 1000

    setInterval(async () => {

        if (app.get('syncing') === 'trades') {
            console.log(`Begin Transactions Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateTrades(app)
            app.set('syncing', 'lm')
            console.log(`Transactions Sync completed at ${new Date()}`)
        } else {
            'Trade sync skipped - another sync in progress'
            return
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }


    }, interval)


    const updateTrades = async (app) => {
        const state = app.get('state')
        let i = app.get('trades_sync_counter')
        const increment = 250

        let leagues_to_update;
        try {
            leagues_to_update = await League.findAll({
                where: {
                    season: state.league_season
                },
                order: [['createdAt', 'ASC']],
                offset: i,
                limit: increment
            })
        } catch (error) {
            console.log(error)
        }
        console.log(`Updating trades for ${i + 1}-${Math.min(i + 1 + increment, i + leagues_to_update.length)} Leagues...`)


        const trades_league = []
        const trades_users = []

        for (let j = 0; j < increment; j += 50) {
            await Promise.all(leagues_to_update.filter(l => l.dataValues.rosters.find(r => r?.players?.length > 0)).slice(j, j + 50).map(async league => {

                let transactions_league;

                try {
                    transactions_league = await axios.get(`https://api.sleeper.app/v1/league/${league.dataValues.league_id}/transactions/${state.season_type === 'regular' ? state.week : 1}`)
                } catch (error) {
                    console.log(error)
                    transactions_league = {
                        data: []
                    }
                }

                try {
                    transactions_league.data
                        .filter(t => t.type === 'trade' && t.status_updated > new Date().getTime() - 30 * 24 * 60 * 60 * 1000)
                        .map(transaction => {
                            const draft_order = league.dataValues.drafts.find(d => d.draft_order && d.status !== 'complete')?.draft_order

                            const managers = transaction.roster_ids.map(roster_id => {
                                const user = league.dataValues.rosters?.find(x => x.roster_id === roster_id)

                                return user?.user_id
                            })

                            const draft_picks = transaction.draft_picks.map(pick => {
                                const roster = league.dataValues.rosters.find(x => x.roster_id === pick.roster_id)
                                const new_roster = league.dataValues.rosters.find(x => x.roster_id === pick.owner_id)
                                const old_roster = league.dataValues.rosters.find(x => x.roster_id === pick.previous_owner_id)

                                return {
                                    ...pick,
                                    original_user: {
                                        user_id: roster?.user_id,
                                        username: roster?.username,
                                        avatar: roster?.avatar,
                                    },
                                    new_user: {
                                        user_id: new_roster?.user_id,
                                        username: new_roster?.username,
                                        avatar: new_roster?.avatar,
                                    },
                                    old_user: {
                                        user_id: old_roster?.user_id,
                                        username: old_roster?.username,
                                        avatar: old_roster?.avatar,
                                    },
                                    order: draft_order && roster?.user_id && pick.season === state.league_season ? draft_order[roster?.user_id] : null
                                }
                            })

                            let adds = {}
                            transaction.adds && Object.keys(transaction.adds).map(add => {
                                const user = league.dataValues.rosters?.find(x => x.roster_id === transaction.adds[add])
                                return adds[add] = user?.user_id
                            })

                            let drops = {}
                            transaction.drops && Object.keys(transaction.drops).map(drop => {
                                const user = league.dataValues.rosters?.find(x => x.roster_id === transaction.drops[drop])
                                return drops[drop] = user?.user_id
                            })

                            const pricecheck = []
                            managers.map(user_id => {
                                const count = Object.keys(adds).filter(a => adds[a] === user_id).length
                                    + draft_picks.filter(pick => pick.new_user.user_id === user_id).length

                                if (count === 1) {
                                    const player = Object.keys(adds).find(a => adds[a] === user_id)
                                    if (player) {
                                        pricecheck.push(player)
                                    } else {
                                        const pick = draft_picks.find(pick => pick.new_user.user_id === user_id)
                                        pricecheck.push(`${pick.season} ${pick.round}.${pick.order}`)
                                    }
                                }
                            })



                            trades_users.push(...managers.filter(m => parseInt(m) > 0).map(m => {
                                return {
                                    userUserId: m,
                                    tradeTransactionId: transaction.transaction_id
                                }
                            }))
                            trades_league.push({
                                transaction_id: transaction.transaction_id,
                                leagueLeagueId: league.dataValues.league_id,
                                status_updated: transaction.status_updated,
                                rosters: league.dataValues.rosters,
                                managers: managers,
                                players: [...Object.keys(adds), ...draft_picks.map(pick => `${pick.season} ${pick.round}.${pick.order}`)],
                                adds: adds,
                                drops: drops,
                                draft_picks: draft_picks,
                                drafts: league.dataValues.drafts,
                                price_check: pricecheck
                            })


                        })

                } catch (error) {
                    console.log(error)
                }


            }))
        }

        try {
            await Trade.bulkCreate(trades_league, { ignoreDuplicates: true })
            await db.sequelize.model('userTrades').bulkCreate(trades_users, { ignoreDuplicates: true })
            const trades_deleted = await Trade.destroy({
                where: {
                    status_updated: {
                        [Op.lt]: new Date().getTime() - 30 * 24 * 60 * 60 * 1000
                    }
                }
            })
            console.log(`${trades_deleted} Trades deleted...`)
        } catch (error) {
            console.log(error)
        }

        if (leagues_to_update.length < increment) {
            app.set('trades_sync_counter', 0)
        } else {
            app.set('trades_sync_counter', i + increment)
        }

    }
}


exports.leaguemates = async (app) => {
    let interval = 1 * 60 * 1000

    setInterval(async () => {



        if (app.get('syncing') === 'lm') {
            console.log(`Begin Leaguemates Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateLeaguemateLeagues(app)
            await deleteLeaguesWithoutAssociations(app)
            app.set('syncing', 'trades')
            console.log(`Leaguemates Sync completed at ${new Date()}`)
        } else {
            'Trade sync skipped - another sync in progress'
            return
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }

    }, interval)

    const deleteLeaguesWithoutAssociations = async (app) => {
        try {
            const associated_league_ids = await db.sequelize.model('userLeagues').findAll({
                attributes: ['leagueLeagueId'],
                distinct: true,
                raw: true
            })

            const associated_league_ids_unique = Array.from(new Set(associated_league_ids.map(league => league.leagueLeagueId)))

            const deleted = await League.destroy({
                where: {
                    league_id: {
                        [Op.not]: associated_league_ids_unique
                    }
                }
            })

            console.log(`${deleted} Leagues with no associated Users deleted...`)
        } catch (error) {
            console.log(error)
        }
    }

    const updateLeaguemateLeagues = async (app) => {
        const state = app.get('state')
        const increment_new = 150;

        const cutoff = new Date(new Date() - (6 * 60 * 60 * 1000))

        const league_ids_dict = await getLeaguemateLeagues(app, state)
        const league_ids = Object.keys(league_ids_dict)

        let leagues_user_db;

        if (league_ids.length > 0) {
            try {
                leagues_user_db = await League.findAll({
                    order: [['updatedAt', 'ASC']],
                    limit: 150,
                    where: {
                        league_id: {
                            [Op.in]: league_ids
                        }
                    },
                    raw: true
                })
            } catch (error) {
                console.log(error)
            }
        } else {
            leagues_user_db = []
        }



        const leagues_to_add = Array.from(new Set([
            ...app.get('leagues_to_add'),
            ...league_ids
                .filter(l => !leagues_user_db.find(l_db => l_db.league_id === l))
        ].flat()))

        const leagues_to_update = Array.from(new Set([
            ...app.get('leagues_to_update'),
            ...leagues_user_db
                .filter(l_db => l_db.updatedAt < cutoff
                    || (
                        l_db.settings.status === 'in_season'
                        && Object.keys(l_db).find(key => key.startsWith('matchups_') && !l_db[key])
                    )
                )
                .flatMap(league => league.league_id)
        ]))

        console.log(`${leagues_to_add.length} Leagues to Add... (${app.get('leagues_to_add').length} from previous)`)
        console.log(`${leagues_to_update.length} Leagues to Update... (${app.get('leagues_to_update').length} from previous)`)

        let leagues_batch;

        if (leagues_to_add.length > 0) {
            const leagues_to_add_batch = leagues_to_add.slice(0, increment_new)

            console.log(`Adding ${leagues_to_add_batch.length} Leagues`)

            const leagues_to_add_pending = leagues_to_add.filter(l => !leagues_to_add_batch.includes(l))

            app.set('leagues_to_add', leagues_to_add_pending)

            app.set('leagues_to_update', leagues_to_update)

            leagues_batch = await getBatchLeaguesDetails(leagues_to_add_batch, state.display_week)

        } else if (leagues_to_update.length > 0) {
            const leagues_to_update_batch = leagues_to_update.slice(0, increment_new)

            console.log(`Updating ${leagues_to_update_batch.length} Leagues`)

            const leagues_to_update_pending = leagues_to_update.filter(l => !leagues_to_update_batch.includes(l))

            app.set('leagues_to_update', leagues_to_update_pending)

            leagues_batch = await getBatchLeaguesDetails(leagues_to_update_batch, state.display_week)

        }


        if (leagues_to_add.length > 0 || leagues_to_update.length > 0) {
            const users = []
            const userLeagueData = []

            leagues_batch.map(league => {
                return (league.rosters
                    ?.filter(r => r.user_id !== null && parseInt(r.user_id) > 0) || [])
                    .map(roster => {
                        userLeagueData.push({
                            userUserId: roster.user_id,
                            leagueLeagueId: league.league_id
                        })

                        if (!users.find(u => u.user_id === roster.user_id)) {
                            users.push({
                                user_id: roster.user_id,
                                username: roster.username,
                                avatar: roster.avatar,
                                type: '',
                                updatedAt: new Date()
                            })
                        }

                    })
            })

            await User.bulkCreate(users, { updateOnDuplicate: ['username', 'avatar'] })
            await League.bulkCreate(leagues_batch, {
                updateOnDuplicate: ["name", "avatar", "settings", "scoring_settings", "roster_positions",
                    "rosters", "drafts", ...Array.from(Array(18).keys()).map(key => `matchups_${key + 1}`), "updatedAt"]
            })

            await db.sequelize.model('userLeagues').bulkCreate(userLeagueData, { ignoreDuplicates: true })
        }


        return
    }

    const getLeaguemateLeagues = async (app, state) => {
        let users_to_update = app.get('users_to_update')
        let leagues_to_update = app.get('leagues_to_add')
        let leagues_to_add = app.get('leagues_to_add')

        if (!(leagues_to_add.length + leagues_to_update.length > 0)) {

            const lm_leagues_cutoff = app.get('lm_leagues_cutoff')
            app.set('lm_leagues_cutoff', new Date())



            let new_users_to_update = await User.findAll({
                order: [['updatedAt', 'ASC']],
                limit: 100,
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
                }
            })

            let all_users_to_update = Array.from(new Set([...users_to_update, ...new_users_to_update.flatMap(user => user.dataValues.user_id)]))

            let users_to_update_batch = all_users_to_update.slice(0, 100)

            const users_to_update_batch_time = users_to_update_batch.map(user => ({
                user_id: user,
                updatedAt: new Date()
            }))

            try {
                await User.bulkCreate(users_to_update_batch_time, { updateOnDuplicate: ['updatedAt'] })
            } catch (error) {
                console.log(error)
            }

            console.log(`Updating ${users_to_update_batch.length} of ${all_users_to_update.length} Total Users (${users_to_update.length} Existing, ${new_users_to_update.length} New)
        : ${all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)).length} Users pending...`)

            app.set('users_to_update', all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)))

            let leaguemate_leagues = {}

            for (const lm of users_to_update_batch) {
                try {
                    const lm_leagues = await axios.get(`http://api.sleeper.app/v1/user/${lm}/leagues/nfl/${state.league_season}`)

                    const deleted = await db.sequelize.model('userLeagues').destroy({
                        where: {
                            [Op.and]: [
                                {
                                    userUserId: lm
                                },
                                {
                                    leagueLeagueId: {
                                        [Op.not]: lm_leagues.data.map(league => league.league_id)
                                    }
                                }
                            ]
                        }
                    })

                    if (deleted > 0) {
                        console.log(`${deleted} associations deleted for user ${lm}`)
                    }

                    lm_leagues.data.map(league => {
                        let leagues = leaguemate_leagues[league.league_id] || []
                        leagues.push(league.league_id)
                        return leaguemate_leagues[league.league_id] = leagues
                    })
                } catch (error) {
                    console.log(error)
                }
            }

            return leaguemate_leagues
        } else {
            return {}
        }

    }

    const getDraftPicks = (traded_picks, rosters, users, drafts, league) => {
        let draft_season;
        if (drafts.find(x => x.status !== 'complete' && x.settings.rounds === league.settings.draft_rounds)) {
            draft_season = parseInt(league.season)
        } else {
            draft_season = parseInt(league.season) + 1
        }

        const draft_order = drafts.find(x => x.status !== 'complete' && x.settings.rounds === league.settings.draft_rounds)?.draft_order

        let original_picks = {}

        for (let i = 0; i < rosters.length; i++) {
            original_picks[rosters[i].roster_id] = []
            for (let j = parseInt(draft_season); j <= parseInt(draft_season) + 2; j++) {

                for (let k = 1; k <= league.settings.draft_rounds; k++) {
                    const original_user = users.find(u => u.user_id === rosters[i].owner_id)

                    if (!traded_picks.find(pick => parseInt(pick.season) === j && pick.round === k && pick.roster_id === rosters[i].roster_id)) {
                        original_picks[rosters[i].roster_id].push({
                            season: j,
                            round: k,
                            roster_id: rosters[i].roster_id,
                            original_user: {
                                avatar: original_user?.avatar || null,
                                user_id: original_user?.user_id || '0',
                                username: original_user?.display_name || 'Orphan'
                            },
                            order: draft_order && draft_order[original_user?.user_id]
                        })
                    }
                }
            }

            for (const pick of traded_picks.filter(x => x.owner_id === rosters[i].roster_id && parseInt(x.season) >= draft_season)) {
                const original_user = users.find(u => rosters.find(r => r.roster_id === pick.roster_id)?.owner_id === u.user_id)
                original_picks[rosters[i].roster_id].push({
                    season: parseInt(pick.season),
                    round: pick.round,
                    roster_id: pick.roster_id,
                    original_user: {
                        avatar: original_user?.avatar || null,
                        user_id: original_user?.user_id || '0',
                        username: original_user?.display_name || 'Orphan'
                    },
                    order: draft_order && draft_order[original_user?.user_id]
                })
            }

            for (const pick of traded_picks.filter(x => x.previous_owner_id === rosters[i].roster_id)) {
                const index = original_picks[rosters[i].roster_id].findIndex(obj => {
                    return obj.season === pick.season && obj.round === pick.round && obj.roster_id === pick.roster_id
                })

                if (index !== -1) {
                    original_picks[rosters[i].roster_id].splice(index, 1)
                }
            }
        }



        return original_picks
    }

    const getLeagueDetails = async (leagueId, display_week) => {
        try {
            const league = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}`)
            const users = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/users`)
            const rosters = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/rosters`)
            const drafts = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/drafts`)
            const traded_picks = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`)

            if (league.data === null) {
                await League.destroy({
                    where: {
                        league_id: leagueId
                    }
                })

                console.log(`League ${leagueId} has been deleted...`)
            } else {
                let matchups = {};
                if (league.data.status === 'in_season') {
                    await Promise.all(Array.from(Array(18).keys())
                        .map(async week => {
                            const matchup_prev = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week + 1}`)

                            matchups[`matchups_${week + 1}`] = (league.data.settings.playoff_week_start < 1 || week + 1 < league.data.settings.playoff_week_start) ? matchup_prev.data : []

                        }))

                }
                const draft_picks = (
                    league.data.status === 'in_season'
                    && league.data.settings.type === 2
                )
                    && getDraftPicks(traded_picks.data, rosters.data, users.data, drafts.data, league.data)
                    || []

                const drafts_array = []

                for (const draft of drafts.data) {
                    drafts_array.push({
                        draft_id: draft.draft_id,
                        status: draft.status,
                        rounds: draft.settings.rounds,
                        draft_order: draft.draft_order
                    })
                }


                const rosters_username = rosters.data
                    ?.sort(
                        (a, b) =>
                            (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)
                            || (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0)
                    );

                for (const [index, roster] of rosters_username.entries()) {
                    const user = users.data.find(u => u.user_id === roster.owner_id);
                    const co_owners = roster.co_owners?.map(co => {
                        const co_user = users.data.find(u => u.user_id === co);
                        return {
                            user_id: co_user?.user_id,
                            username: co_user?.display_name,
                            avatar: co_user?.avatar
                        };
                    });
                    rosters_username[index] = {
                        rank: index + 1,
                        taxi: roster.taxi,
                        starters: roster.starters,
                        settings: roster.settings,
                        roster_id: roster.roster_id,
                        reserve: roster.reserve,
                        players: roster.players,
                        user_id: roster.owner_id,
                        username: user?.display_name,
                        avatar: user?.avatar,
                        co_owners,
                        draft_picks: draft_picks[roster.roster_id]
                    };
                }

                const {
                    type,
                    best_ball,
                    trade_deadline,
                    waiver_day_of_week,
                    daily_waivers_hour,
                    league_average_match,
                    playoff_week_start
                } = league.data.settings || {}

                const settings = {
                    type,
                    best_ball,
                    trade_deadline,
                    waiver_day_of_week,
                    daily_waivers_hour,
                    league_average_match,
                    playoff_week_start,
                    status: league.data.status
                }

                return {
                    league_id: leagueId,
                    name: league.data.name,
                    avatar: league.data.avatar,
                    season: league.data.season,
                    settings: settings,
                    scoring_settings: league.data.scoring_settings,
                    roster_positions: league.data.roster_positions,
                    rosters: rosters_username,
                    drafts: drafts_array,
                    ...matchups,
                    updatedAt: Date.now()
                }
            }
        } catch (error) {
            console.error(`Error processing league ${leagueId}: ${error.message}`);

        }
    }

    const getBatchLeaguesDetails = async (leagueIds, display_week) => {

        const allResults = [];

        const chunkSize = 10;

        for (let i = 0; i < leagueIds.length; i += chunkSize) {
            const chunk = leagueIds.slice(i, i + chunkSize);
            const chunkResults = await Promise.all(chunk.map(async (leagueId) => {
                const result = await getLeagueDetails(leagueId, display_week);
                return result !== null ? result : undefined;
            }));
            allResults.push(...chunkResults);
        }

        return allResults.filter(result => result !== undefined);
    }
}


exports.userTrades = async (app) => {

    for (let i = 0; i < 250000; i += 25000) {
        const trades = await Trade.findAll({
            order: [['transaction_id', 'DESC']],
            offset: i,
            limit: 25000,
            attributes: ['transaction_id', 'managers'],
            raw: true

        })

        const userTradeData = []

        trades.map(trade => {
            return trade.managers
                .filter(m => parseInt(m) > 0)
                .map(m => {
                    return userTradeData.push({
                        userUserId: m,
                        tradeTransactionId: trade.transaction_id
                    })
                })
        })


        try {

            await db.sequelize.model('userTrades').bulkCreate(userTradeData, { ignoreDuplicates: true })
            console.log(`Updated trades for leagues ${i}-${i + 25000}`)
        } catch (error) {
            console.log(error)
        }
    }
}










