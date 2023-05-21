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

        const stateAllPlayers = app.get('allplayers')
        const ktc = await axios.post('https://keeptradecut.com/dynasty-rankings/history')

        const daily_values = {}

        ktc.data.map(ktc_player => {
            const sleeper_id = matchPlayer(ktc_player, stateAllPlayers)
            daily_values[sleeper_id] = {
                oneqb: ktc_player.oneQBValues.value,
                sf: ktc_player.superflexValues.value
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
