const jwt = require('jsonwebtoken');

function sign(payload, secret, options = {}) {
    return jwt.sign(payload, secret, options);
}

function verify(token, secret) {
    return jwt.verify(token, secret);
}

module.exports = { sign, verify };
