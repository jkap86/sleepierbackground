'use strict'
const dbConfig = require("../config/db.config");

const Sequelize = require("sequelize");

const ssl = process.env.HEROKU ? { rejectUnauthorized: false } : false

const sequelize = new Sequelize(dbConfig.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: ssl, useUTC: false },
    logging: false,
    pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
    }
});

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.users = require("./user.model.js")(sequelize, Sequelize);
db.leagues = require("./league.model.js")(sequelize, Sequelize);
db.trades = require("./trade.model.js")(sequelize, Sequelize);

const player_data = require("./dynastyrankings.model.js")(sequelize, Sequelize)
db.dynastyrankings = player_data.DynastyRankings
db.stats = player_data.Stats

db.users.belongsToMany(db.leagues, { through: { model: 'userLeagues' } })
db.leagues.belongsToMany(db.users, { through: { model: 'userLeagues' } })

db.leagues.hasMany(db.trades)
db.trades.belongsTo(db.leagues)

db.users.belongsToMany(db.trades, { through: { model: 'userTrades', onDelete: 'CASCADE' } })
db.trades.belongsToMany(db.users, { through: { model: 'userTrades', onDelete: 'CASCADE' } })

/*
db.users.belongsToMany(db.users, { as: 'leaguemates', through: 'userLeaguemates' })

db.users.belongsToMany(db.trades, { through: db.lmTrades, as: 'trades1' })
db.trades.belongsToMany(db.users, { through: db.lmTrades, as: 'users1', indexes: [{ using: 'BRIN', fields: ['userUserId'] }] })

db.users.belongsToMany(db.trades, { through: 'lmLeaguesTrades', as: 'trades2' })
db.trades.belongsToMany(db.users, { through: 'lmLeaguesTrades', as: 'users2', indexes: [{ name: 'idx_lmlt', using: 'BRIN', fields: ['userUserId', 'status_updated'] }] })
*/

module.exports = db;