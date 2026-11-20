const jwt = require('jsonwebtoken');
const db = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET || 'med-blockchain-jwt-super-secret-key-2026';

/**
 * Strips sensitive credential fields before sending user objects to the client
 */
function sanitizeUser(user, includeBillNumber = true) {
    if (!user) return null;
    const { password, passwordHash, ...safeUser } = user;
    if (!includeBillNumber) {
        delete safeUser.billNumber;
        delete safeUser.receptionId;
    }
    return safeUser;
}

/**
 * Authentication middleware that strictly verifies signed JWT tokens
 * (Patched: Removed unverified x-demo-user-id header/query parameter bypass to prevent spoofing)
 */
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required. Valid signed JWT token missing.'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.findUserById(decoded.id);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found in SIT Students Hospital database.' });
        }
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired session token.',
            error: err.message
        });
    }
}

/**
 * Role-Based Access Control (RBAC) guard
 * @param  {...string} allowedRoles ('Doctor', 'Lab Staff', 'Patient', 'Admin')
 */
function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required.' });
        }

        if (!allowedRoles.includes(req.user.role) && req.user.role !== 'Admin') {
            return res.status(403).json({
                success: false,
                message: `Access denied. Role '${req.user.role}' is not authorized for this healthcare operation. Required: [${allowedRoles.join(', ')}]`
            });
        }

        next();
    };
}

module.exports = {
    authenticate,
    authorizeRoles,
    sanitizeUser,
    JWT_SECRET
};
