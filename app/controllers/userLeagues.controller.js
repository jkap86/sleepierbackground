'use strict';

const db = require("../models");
const User = db.users;
const League = db.leagues;
const Op = db.Sequelize.Op;
const axios = require('../api/axiosInstance');

exports.userLeagues = async (app) => {
    setTimeout(async () => {
        app.set('syncing', false)
        console.log(`Beginning user/league sync...`);

        const state = app.get('state')

        let league_ids_queue = app.get('league_ids_queue');


        console.log(`${league_ids_queue.length} Leagues in queue...`);
        let new_league_ids = [];
        if (league_ids_queue.length < 100) {


            try {
                // Get User_ids to update

                const lm_leagues_cutoff = app.get('lm_leagues_cutoff');
                app.set('lm_leagues_cutoff', new Date());

                let new_users_to_update = await User.findAll({
                    order: [['updatedAt', 'ASC']],
                    limit: 100,
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
                                            [Op.lt]: new Date(new Date() - .5 * 60 * 1000)
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

                const batchSize = 10;

                for (let i = 0; i < new_users_to_update.length; i += batchSize) {
                    const batch = new_users_to_update.slice(i, i + batchSize);

                    const batchResults = await Promise.all(
                        batch.map(async user => {
                            const leagues = await axios.get(`http://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${state.league_season}`)

                            return leagues.data.map(league => league.league_id);
                        })
                    )

                    new_league_ids.push(...batchResults)
                }
                new_league_ids = Array.from(new Set(new_league_ids.flat())).filter(league_id => !league_ids_queue.includes(league_id));
                console.log(`${new_league_ids.length} new Leagues to add`);
            } catch (error) {
                console.log(error.message)
            }
        }

        league_ids_queue = [...league_ids_queue, ...new_league_ids]
        //  Get leagues that have not been updated since cutoff from db  

        const cutoff = new Date(new Date() - (6 * 60 * 60 * 1000))

        let leagues_db;
        let league_ids_to_update;
        try {
            leagues_db = await League.findAll({
                order: [['updatedAt', 'ASC']],
                limit: 150,
                attributes: ['league_id'],
                where: {
                    [Op.and]: [
                        {
                            league_id: league_ids_queue
                        },
                        {
                            updatedAt: {
                                [Op.lt]: cutoff
                            }
                        }
                    ]
                },
                raw: true
            })

            league_ids_to_update = leagues_db.map(league => league.league_id);


        } catch (error) {
            console.log(error.message)
        }




        const league_ids_to_add = league_ids_queue
            .filter(league_id => !leagues_db?.find(league => league.league_id === league_id))
            .splice(0, 150);


        app.set('league_ids_queue', league_ids_queue)



        const leagues_to_add_updated = await getBatchLeaguesDetails(league_ids_to_add, state.display_week, true);
        const leagues_to_update_updated = await getBatchLeaguesDetails(league_ids_to_update, state.display_week, false);

        const users = [];
        const userLeagueData = [];

        [...leagues_to_add_updated, ...leagues_to_update_updated]
            .forEach(league => {
                league.rosters
                    ?.filter(r => r.user_id !== null && parseInt(r.user_id) > 0) || []
                        ?.forEach(roster => {
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

        try {
            await User.bulkCreate(users, { updateOnDuplicate: ['username', 'avatar'] });

            await League.bulkCreate(leagues_to_add_updated, {
                updateOnDuplicate: ["name", "avatar", "settings", "scoring_settings", "roster_positions",
                    "rosters", "drafts", ...Array.from(Array(18).keys()).map(key => `matchups_${key + 1}`), "updatedAt"]
            });

            await League.bulkCreate(leagues_to_update_updated, {
                updateOnDuplicate: ["name", "avatar", "settings", "scoring_settings", "roster_positions",
                    "rosters", "drafts", ...Array.from(Array(18 - state.display_week).keys()).map(key => `matchups_${key + 1}`), "updatedAt"]
            })

            await db.sequelize.model('userLeagues').bulkCreate(userLeagueData, { ignoreDuplicates: true });

        } catch (error) {
            console.log(error)
        }

        app.set('syncing', 'userLeagues')
        console.log(`User/League sync complete...`)
    }, 10000)
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

const getLeagueDetails = async (leagueId, display_week, new_league = false) => {
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
                if (new_league) {
                    await Promise.all(Array.from(Array(18).keys())
                        .map(async week => {
                            const matchup_prev = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week + 1}`)

                            matchups[`matchups_${week + 1}`] = (league.data.settings.playoff_week_start < 1 || week + 1 < league.data.settings.playoff_week_start) ? matchup_prev.data : []

                        }))
                } else {
                    await Promise.all(Array.from(Array(18 - display_week).keys())
                        .map(async week => {
                            const matchup_prev = await axios.get(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week + 1}`)

                            matchups[`matchups_${week + 1}`] = (league.data.settings.playoff_week_start < 1 || week + 1 < league.data.settings.playoff_week_start) ? matchup_prev.data : []

                        }))
                }
            } else {
                Array.from(Array(18).keys())
                    .forEach(week => {
                        matchups[`matchups_${week + 1}`] = []
                    })
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


            const rosters_username = [...rosters.data]
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