'use strict'
const db = require("../models");
const DynastyRankings = db.dynastyrankings;
const axios = require('../api/axiosInstance');

const matchPlayer = (player, stateAllPlayers) => {
    const matchTeam = (team) => {
        const team_abbrev = {
            SFO: 'SF',
            JAC: 'JAX',
            KCC: 'KC',
            TBB: 'TB',
            GBP: 'GB',
            NEP: 'NE',
            LVR: 'LV',
            NOS: 'NO'
        }
        return team_abbrev[team] || team
    }

    if (player.position === 'RDP') {
        return player.playerName.slice(0, -2)
    } else {

        const players_to_search = Object.keys(stateAllPlayers || {})
            .map(player_id => {
                let match_score = 0

                if (stateAllPlayers[player_id]?.active === true
                    && stateAllPlayers[player_id]?.position === player.position) {
                    match_score += 1
                }
                if (stateAllPlayers[player_id]?.college === player.college) {
                    match_score += 1
                }
                if (stateAllPlayers[player_id]?.number === player.number) {
                    match_score += 1
                }
                if ((stateAllPlayers[player_id]?.team || 'FA') === matchTeam(player.team)) {
                    match_score += 1
                }
                if (stateAllPlayers[player_id]?.years_exp === player.seasonsExperience || 0) {
                    match_score += 1
                }
                if (player.playerName?.replace('III', '').replace('II', '').replace('Jr', '').trim().toLowerCase().replace(/[^a-z]/g, "") === stateAllPlayers[player_id]?.search_full_name?.trim()) {
                    match_score += 5
                }

                return {
                    player_id: player_id,
                    match_score: match_score
                }
            })
            .sort((a, b) => b.match_score - a.match_score)

        return players_to_search[0].player_id
    }

}


exports.updateDaily = async (app) => {
    const getDailyValues = async () => {

        console.log(`Beginning daily rankings update at ${new Date()}`)

        const stateAllPlayers = require('../../allplayers.json');

        let ktc;
        try {
            ktc = await axios.post('https://keeptradecut.com/dynasty-rankings/histories')
        } catch (err) {
            console.log(err)
        }

        let fc_sf_dynasty
        try {
            fc_sf_dynasty = await axios.get(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1`)
        } catch (err) {
            console.log(err)
        }

        let fc_sf_redraft
        try {
            fc_sf_redraft = await axios.get(`https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=12&ppr=1`)
        } catch (err) {
            console.log(err)
        }

        let fc_oneqb_dynasty
        try {
            fc_oneqb_dynasty = await axios.get(`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1`)
        } catch (err) {
            console.log(err)
        }

        let fc_oneqb_redraft
        try {
            fc_oneqb_redraft = await axios.get(`https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1`)
        } catch (err) {
            console.log(err)
        }

        const daily_values = {}

        ktc.data.forEach(ktc_player => {
            const sleeper_id = matchPlayer(ktc_player, stateAllPlayers)

            const oneqb_dynasty_fc = fc_oneqb_dynasty.data
                .find(p => p.player.sleeperId === sleeper_id)
                ?.value

            const sf_dynasty_fc = fc_sf_dynasty.data
                .find(p => p.player.sleeperId === sleeper_id)
                ?.value

            const oneqb_redraft_fc = fc_oneqb_redraft.data
                .find(p => p.player.sleeperId === sleeper_id)
                ?.value

            const sf_redraft_fc = fc_sf_redraft.data
                .find(p => p.player.sleeperId === sleeper_id)
                ?.value

            daily_values[sleeper_id] = {
                oneqb: ktc_player.oneQBValues.value,
                sf: ktc_player.superflexValues.value,
                oneqb_dynasty_fc: oneqb_dynasty_fc,
                sf_dynasty_fc: sf_dynasty_fc,
                oneqb_redraft_fc: oneqb_redraft_fc,
                sf_redraft_fc: sf_redraft_fc
            }
        })

        Array.from(
            new Set(
                ...fc_oneqb_dynasty.data.map(p => p.player.sleeperId),
                ...fc_oneqb_redraft.data.map(p => p.player.sleeperId),
                ...fc_sf_dynasty.data.map(p => p.player.sleeperId),
                ...fc_sf_redraft.data.map(p => p.player.sleeperId)
            )
        )
            .filter(player_id =>
                !Object.keys(daily_values).includes(player_id)
            )
            .forEach(player_id => {
                const oneqb_dynasty_fc = fc_oneqb_dynasty.data
                    .find(p => p.player.sleeperId === player_id)
                    ?.value

                const sf_dynasty_fc = fc_sf_dynasty.data
                    .find(p => p.player.sleeperId === player_id)
                    ?.value

                const oneqb_redraft_fc = fc_oneqb_redraft.data
                    .find(p => p.player.sleeperId === player_id)
                    ?.value

                const sf_redraft_fc = fc_sf_redraft.data
                    .find(p => p.player.sleeperId === player_id)
                    ?.value

                daily_values[player_id] = {
                    oneqb_dynasty_fc: oneqb_dynasty_fc,
                    sf_dynasty_fc: sf_dynasty_fc,
                    oneqb_redraft_fc: oneqb_redraft_fc,
                    sf_redraft_fc: sf_redraft_fc
                }
            })


        try {
            await DynastyRankings.upsert({
                date: new Date(new Date().getTime()),
                values: daily_values

            })
        } catch (error) {
            console.log(error)
        }

        console.log(`Update Complete`)
    }



    const eastern_time = new Date(new Date().getTime() - 240 * 60 * 1000)

    const delay = ((60 - new Date(eastern_time).getMinutes()) * 60 * 1000);

    console.log(`next rankings update at ${delay / 60000} min`)
    setTimeout(async () => {

        await getDailyValues()

        setInterval(async () => {
            await getDailyValues()
        }, 1 * 60 * 60 * 1000)

    }, 10000)
}


exports.values = async (app) => {
    app.set('syncing', true)

    const type1 = 'sf'
    const type2 = 'dynasty'

    const current_values = await axios.get(`https://api.fantasycalc.com/values/current?isDynasty=${type2 === 'dynasty' ? 'true' : 'false'}&numQbs=${type1 === 'sf' ? '2' : '1'}&numTeams=12&ppr=1`)

    const player_ids = current_values.data.sort((a, b) => parseInt(a.value) - parseInt(b.value))

    console.log(`Getting FC values for ${player_ids.length} players...`)

    setTimeout(async () => {

        const fc_values = {};

        const players_retry = []

        for (const player of player_ids) {

            console.log(`Getting FC values for player ${player.player.name}...`)

            let sf

            try {
                sf = await axios.get(`https://api.fantasycalc.com/trades/implied/${player.player.id}?isDynasty=${type2 === 'dynasty' ? 'true' : 'false'}&numQbs=${type1 === 'sf' ? '2' : '1'}`)

                fc_values[player.player.sleeperId.includes("P") ? player.player.name : player.player.sleeperId] = {
                    sleeperId: player.player.sleeperId,
                    name: player.player.name,
                    [`${type1}_${type2}`]: sf?.data?.historicalValues || [],
                }
            } catch (error) {
                players_retry.push(player)
                console.log(`Error getting player ${player.player.name}`)
            }
        }

        for (const player of players_retry) {

            console.log(`RETRY Getting FC values for player ${player.player.name}...`)

            let sf

            try {
                sf = await axios.get(`https://api.fantasycalc.com/trades/implied/${player.player.id}?isDynasty=${type2 === 'dynasty' ? 'true' : 'false'}&numQbs=${type1 === 'sf' ? '2' : '1'}`)

                fc_values[player.player.sleeperId.includes("P") ? player.player.name : player.player.sleeperId] = {
                    sleeperId: player.player.sleeperId,
                    name: player.player.name,
                    [`${type1}_${type2}`]: sf?.data?.historicalValues || [],
                }
            } catch (error) {
                players_retry.push(player)
                console.log(`RETRY Error getting player ${player.player.name}`)
            }
        }

        fs.writeFile(`fc_values_${type1}_${type2}.json`, JSON.stringify(fc_values), (err) => {
            if (err) {
                console.log(err);
                return;
            }
            console.log('Data written to fc_values.json successfully...')
        })
    }, 3000)
}


exports.updateWithFC = async (app) => {

    setTimeout(async () => {
        const updated_values = []
        const db_values = await DynastyRankings.findAll({})

        db_values
            .sort((a, b) => new Date(a.dataValues.date) - new Date(b.dataValues.date))
            .forEach(date => {
                console.log(`Updating values for ${date.dataValues.date}`)

                const updated_date_values = {}


                Object.keys(date.dataValues.values)
                    .forEach(player_id => {
                        const oneqb_dynasty_fc = oneqb_dynasty[player_id]
                            ?.oneqb_dynasty
                            ?.find(d => new Date(d.date).toLocaleDateString("en-US") === new Date(date.dataValues.date).toLocaleDateString("en-US"))
                            ?.value

                        const sf_dynasty_fc = sf_dynasty[player_id]
                            ?.sf_dynasty
                            ?.find(d => new Date(d.date).toLocaleDateString("en-US") === new Date(date.dataValues.date).toLocaleDateString("en-US"))
                            ?.value

                        const oneqb_redraft_fc = oneqb_redraft[player_id]
                            ?.oneqb_redraft
                            ?.find(d => new Date(d.date).toLocaleDateString("en-US") === new Date(date.dataValues.date).toLocaleDateString("en-US"))
                            ?.value

                        const sf_redraft_fc = sf_redraft[player_id]
                            ?.sf_redraft
                            ?.find(d => new Date(d.date).toLocaleDateString("en-US") === new Date(date.dataValues.date).toLocaleDateString("en-US"))
                            ?.value

                        updated_date_values[player_id] = {
                            ...(date.dataValues.values[player_id] || {}),
                            oneqb_dynasty_fc: oneqb_dynasty_fc,
                            sf_dynasty_fc: sf_dynasty_fc,
                            oneqb_redraft_fc: oneqb_redraft_fc,
                            sf_redraft_fc: sf_redraft_fc,
                        }
                    })

                updated_values.push({
                    date: date.dataValues.date,
                    values: updated_date_values,
                    updatedAt: new Date()
                })

            })

        fs.writeFile(`values_w_fc.json`, JSON.stringify(updated_values), (err) => {
            if (err) {
                console.log(err);
                return;
            }
            console.log('Data written to values_w_fc.json successfully...')
        })
    }, 3000)
}


exports.updateDB = async (app) => {
    const values_w_fc = require('../../values_w_fc.json');

    setTimeout(async () => {
        try {
            console.log('Begin Update')
            await DynastyRankings.bulkCreate(values_w_fc.map(d => {
                return {
                    ...d,
                    date: new Date(d.date)
                }
            }), { updateOnDuplicate: ['values', 'updatedAt'] })
            console.log("UPDATE COMPLETE")
        } catch (err) {
            console.log(err)
        }
    }, 5000)
}