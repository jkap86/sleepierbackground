'use strict'

module.exports = (sequelize, Sequelize) => {

    const User = sequelize.define("user", {
        user_id: {
            type: Sequelize.STRING,
            allowNUll: false,
            primaryKey: true
        },
        username: {
            type: Sequelize.STRING
        },
        avatar: {
            type: Sequelize.STRING
        },
        type: {
            type: Sequelize.STRING
        }
    }, {
        indexes: [
            {
                fields: ['user_id'],

            }
        ]
    });

    return User;
};