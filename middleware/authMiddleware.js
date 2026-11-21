const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');

/**
 * Strips sensitive credential fields before sending user objects to the client.
 * Accepts either options object or legacy boolean for includeBillNumber.
 */
function sanitizeUser(user, options = false) {
    if (!user) return null;
    const opts = typeof options === 'boolean'
        ? { includeBillNumber: options, includeContact: options }
        : { includeBillNumber: false, includeContact: false, ...options };

    const {
        password,
        passwordHash,
        accessCodeHash,
        accessCodeExpiresAt,
        accessCodeUsed,
        accessCodeUsedAt,
        ...safeUser
    } = user;

    if (!opts.includeBillNumber) {
        delete safeUser.billNumber;
        delete safeUser.receptionId;
    }
    if (!opts.includeContact) {
        delete safeUser.email;
        delete safeUser.contact;
    }
    return safeUser;
}

/**
 * Verifies a Bearer JWT token strictly (HS256, active user, matching tokenVersion).
 */
function verifyBearerToken(token) {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    const user = db.findUserById(decoded.id);
    if (!user || user.disabled) {
        return { ok: false, message: 'Account not found or disabled.' };
    }

    const currentVer = Number(user.tokenVersion) || 0;
    if (decoded.ver !== undefined) {
        if (Number(decoded.ver) !== currentVer) {
            return { ok: false, message: 'Session token has been invalidated. Please sign in again.' };
        }
    } else if (currentVer > 0) {
        return { ok: false, message: 'Session token invalidated after credential change. Please sign in again.' };
    }

    return { ok: true, user, decoded };
}

/**
 * Strict JWT authentication middleware.
 * Accepts tokens ONLY in the Authorization: Bearer header (rejects ?token= query strings).
 */
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    } else if (req.query && req.query.token) {
        return res.status(401).json({
            success: false,
            message: 'Bearer tokens in URL query strings are not permitted. Use the Authorization header.'
        });
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required. Valid signed JWT token missing.'
        });
    }

    try {
        const result = verifyBearerToken(token);
        if (!result.ok) {
            return res.status(401).json({ success: false, message: result.message });
        }

        const user = result.user;
        req.user = user;
        req.auth = result.decoded;

        // Enforce forced password change gate before allowing any clinical/admin APIs
        if (user.mustChangePassword) {
            const path = req.path || '';
            const allowedWhileLocked = (
                (req.method === 'GET' && path === '/api/auth/me') ||
                (req.method === 'POST' && path === '/api/auth/change-password')
            );
            if (!allowedWhileLocked) {
                return res.status(403).json({
                    success: false,
                    code: 'PASSWORD_CHANGE_REQUIRED',
                    message: 'Password change required before accessing hospital resources.'
                });
            }
        }

        return next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired session token.'
        });
    }
}

/**
 * Optional authentication middleware for public-or-rich endpoints (e.g. QR verification).
 * Never rejects anonymous callers; sets req.user only if a valid Bearer token is presented.
 */
function optionalAuthenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        try {
            const result = verifyBearerToken(token);
            if (result.ok && !result.user.mustChangePassword) {
                req.user = result.user;
                req.auth = result.decoded;
            }
        } catch (_) {}
    }
    return next();
}

/**
 * Explicit Role-Based Access Control (RBAC) guard.
 * Admin has NO implicit global bypass — Admin must be explicitly listed when permitted.
 */
function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access denied. Role '${req.user.role}' is not authorized for this operation.`
            });
        }

        return next();
    };
}

module.exports = {
    authenticate,
    optionalAuthenticate,
    authorizeRoles,
    sanitizeUser,
    verifyBearerToken
};
