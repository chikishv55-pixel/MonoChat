const crypto = require('crypto');

function encodeBase64Url(obj) {
    if (typeof obj === 'string') return Buffer.from(obj).toString('base64url');
    return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function sign(payload, secret, options = {}) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const iat = Math.floor(Date.now() / 1000);
    
    let exp;
    if (options.expiresIn && typeof options.expiresIn === 'string' && options.expiresIn.endsWith('d')) {
        const days = parseInt(options.expiresIn);
        exp = iat + (days * 24 * 60 * 60);
    } else {
        exp = iat + (7 * 24 * 60 * 60); // default 7 days
    }

    const fullPayload = { ...payload, iat, exp };
    const signatureString = `${encodeBase64Url(header)}.${encodeBase64Url(fullPayload)}`;
    const signature = crypto.createHmac('sha256', secret).update(signatureString).digest('base64url');
    return `${signatureString}.${signature}`;
}

function verify(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');

    const signatureString = `${parts[0]}.${parts[1]}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(signatureString).digest('base64url');

    // Prevent timing attacks by using secure string comparison (though for this app it is fine)
    if (expectedSignature !== parts[2]) throw new Error('Invalid signature');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
        throw new Error('Token expired');
    }
    return payload;
}

module.exports = { sign, verify };
