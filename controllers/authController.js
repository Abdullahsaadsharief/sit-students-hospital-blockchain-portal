const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');
const { sanitizeUser } = require('../middleware/authMiddleware');
const { hashPassword, verifyPassword, verifyAgainstDummy } = require('../utils/passwords');
const { ethereumClient } = require('../blockchain/ethereumClient');
const { cloudPersistence } = require('../utils/cloudPersistence');

function signSessionToken(user) {
    return jwt.sign(
        {
            id: user.id,
            role: user.role,
            ver: Number(user.tokenVersion) || 0,
            jti: crypto.randomBytes(12).toString('hex')
        },
        config.JWT_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: '8h'
        }
    );
}

/**
 * Public non-sensitive server configuration (DEMO_MODE status & live Ethereum blockchain connectivity)
 */
function getPublicConfig(req, res) {
    return res.json({
        success: true,
        demoMode: config.DEMO_MODE,
        aiExternalProcessing: config.AI_EXTERNAL_PROCESSING,
        blockchain: ethereumClient.getStatus(),
        persistence: cloudPersistence.getStatus()
    });
}

/**
 * Staff-only directory listing (Doctor, Lab Staff, Receptionist, Admin).
 * Returns minimal identity fields; full contact & bill numbers only for Receptionist & Admin.
 */
function getAllUsers(req, res) {
    const canSeeBillingAndContact = req.user.role === 'Receptionist' || req.user.role === 'Admin';
    const roleFilter = (req.query && typeof req.query.role === 'string') ? req.query.role.trim().toLowerCase() : '';
    const users = db.getAllUsers()
        .filter(u => !u.disabled)
        .filter(u => !roleFilter || (u.role && u.role.toLowerCase() === roleFilter))
        .map(u => {
            if (canSeeBillingAndContact) {
                return sanitizeUser(u, { includeBillNumber: true, includeContact: true });
            }
            // Minimal clinical selection fields for Doctors & Lab Staff
            return {
                id: u.id,
                name: u.name,
                role: u.role,
                patientId: u.patientId || null,
                department: u.department || null,
                hospital: u.hospital || null,
                designation: u.designation || null,
                laboratory: u.laboratory || null,
                age: u.age ?? null,
                gender: u.gender || null,
                bloodGroup: u.bloodGroup || null
            };
        });

    return res.json({ success: true, users });
}

/**
 * DEMO_MODE ONLY: Returns synthetic demo accounts for one-click academic presentation cards
 */
function getDemoAccounts(req, res) {
    if (!config.DEMO_MODE) {
        return res.status(404).json({ success: false, message: 'Not found.' });
    }
    const accounts = db.getAllUsers()
        .filter(u => u.isDemoAccount && !u.disabled)
        .map(u => ({
            id: u.id,
            name: u.name,
            role: u.role,
            department: u.department || u.designation || u.hospital || 'SIT Students Hospital',
            patientId: u.patientId || null,
            billNumber: u.billNumber || null
        }));
    return res.json({ success: true, accounts });
}

/**
 * DEMO_MODE ONLY: One-click synthetic demo login (never mounted when DEMO_MODE=false)
 */
function demoLogin(req, res) {
    if (!config.DEMO_MODE) {
        return res.status(404).json({ success: false, message: 'Not found.' });
    }
    const { userId } = req.body || {};
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ success: false, message: 'Demo userId is required.' });
    }

    const user = db.findUserById(userId.trim());
    if (!user || !user.isDemoAccount || user.disabled) {
        return res.status(401).json({ success: false, message: 'Demo account unavailable.' });
    }

    const token = signSessionToken(user);
    db.logAudit('DEMO_USER_LOGIN', user.name, `Synthetic demo login via DEMO_MODE as ${user.role}`);

    return res.json({
        success: true,
        message: `Demo session started as ${user.name} (${user.role}).`,
        token,
        user: sanitizeUser(user, { includeBillNumber: true, includeContact: true })
    });
}

/**
 * Hardened Credential Login:
 * - Rejects ID-only login for all roles (F-01).
 * - Rejects bill-number-only login for patients (requires Bill Number + 8-char Access Code OR Password).
 * - Rejects demo accounts when DEMO_MODE=false.
 * - Uses scrypt + timingSafeEqual + constant-time dummy verification; always returns generic 401 on failure.
 */
function login(req, res) {
    const { email, identifier, password, billNumber, accessCode } = req.body || {};

    const rawIdentifier = String(identifier || email || billNumber || '').trim();
    const rawPassword = typeof password === 'string' ? password : '';
    const rawAccessCode = typeof accessCode === 'string' ? accessCode.trim().toUpperCase() : '';

    // Never allow passwordless or ID-only login
    if (!rawIdentifier || (!rawPassword && !rawAccessCode)) {
        verifyAgainstDummy('missing-credential');
        return res.status(401).json({
            success: false,
            message: 'Invalid credentials.'
        });
    }

    const cleanLookup = rawIdentifier.toLowerCase();
    let user = db.findUserByEmail(cleanLookup);
    if (!user) {
        user = db.getAllUsers().find(u =>
            (u.billNumber && u.billNumber.toLowerCase() === cleanLookup) ||
            (u.receptionId && u.receptionId.toLowerCase() === cleanLookup) ||
            (u.patientId && u.patientId.toLowerCase() === cleanLookup)
        );
    }

    // Reject unknown, disabled, or demo accounts outside DEMO_MODE with identical timing & 401
    if (!user || user.disabled || (user.isDemoAccount && !config.DEMO_MODE)) {
        verifyAgainstDummy(rawPassword || rawAccessCode);
        return res.status(401).json({
            success: false,
            message: 'Invalid credentials.'
        });
    }

    // Path A: Patient first-time / reset login using Bill Number + 8-character One-Time Access Code
    if (rawAccessCode && !rawPassword) {
        const isValidPatientAccessCode = (
            user.role === 'Patient' &&
            Boolean(user.accessCodeHash) &&
            !user.accessCodeUsed &&
            Boolean(user.accessCodeExpiresAt) &&
            new Date(user.accessCodeExpiresAt).getTime() > Date.now()
        );

        const codeMatched = isValidPatientAccessCode
            ? verifyPassword(rawAccessCode, user.accessCodeHash)
            : verifyAgainstDummy(rawAccessCode);

        if (!isValidPatientAccessCode || !codeMatched) {
            db.logAudit('FAILED_LOGIN_ATTEMPT', user.name, `Failed one-time access code login for ${user.id}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.'
            });
        }

        // Consume one-time code immediately and force password setup
        db.updateUser(user.id, {
            accessCodeUsed: true,
            accessCodeUsedAt: new Date().toISOString(),
            accessCodeHash: null,
            mustChangePassword: true
        });
        const refreshed = db.findUserById(user.id);
        const token = signSessionToken(refreshed);

        db.logAudit('PATIENT_ACCESS_CODE_LOGIN', refreshed.name, `Patient authenticated via one-time access code (Bill: ${refreshed.billNumber}); password setup required.`);

        return res.json({
            success: true,
            message: `Welcome, ${refreshed.name}! Please set your personal password to continue.`,
            mustChangePassword: true,
            token,
            user: sanitizeUser(refreshed, { includeBillNumber: true, includeContact: true })
        });
    }

    // Path B: Standard password verification (for Staff, Admin, and Patients with an established password)
    if (!rawPassword || !verifyPassword(rawPassword, user.passwordHash)) {
        db.logAudit('FAILED_LOGIN_ATTEMPT', user.name, `Failed password login for ${user.role} (${user.id})`);
        return res.status(401).json({
            success: false,
            message: 'Invalid credentials.'
        });
    }

    const token = signSessionToken(user);
    db.logAudit('USER_LOGIN', user.name, `Authenticated successfully with role: ${user.role}`);

    return res.json({
        success: true,
        message: `Welcome, ${user.name}!`,
        mustChangePassword: Boolean(user.mustChangePassword),
        token,
        user: sanitizeUser(user, { includeBillNumber: true, includeContact: true })
    });
}

/**
 * Authenticated password change (also unlocks accounts with mustChangePassword: true).
 * Increments tokenVersion to invalidate all previous sessions and issues a fresh JWT.
 */
function changePassword(req, res) {
    const user = req.user;
    const { currentPassword, newPassword } = req.body || {};

    if (typeof newPassword !== 'string' || newPassword.trim().length < 10) {
        return res.status(400).json({
            success: false,
            message: 'New password must contain at least 10 non-whitespace characters.'
        });
    }

    if (config.REJECTED_DEFAULT_SECRETS.has(newPassword.trim())) {
        return res.status(400).json({
            success: false,
            message: 'Please choose a stronger password that is not a common default.'
        });
    }

    // Require currentPassword unless the user is completing a forced first-time/reset password setup
    if (!user.mustChangePassword) {
        if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, user.passwordHash)) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect.'
            });
        }
    }

    if (user.passwordHash && verifyPassword(newPassword, user.passwordHash)) {
        return res.status(400).json({
            success: false,
            message: 'New password must be different from your current password.'
        });
    }

    const nextVersion = (Number(user.tokenVersion) || 0) + 1;
    const updated = db.updateUser(user.id, {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        tokenVersion: nextVersion,
        passwordUpdatedAt: new Date().toISOString()
    });

    const freshToken = signSessionToken(updated);
    db.logAudit('PASSWORD_CHANGED', updated.name, `Password updated and prior session tokens invalidated (ver=${nextVersion})`);

    return res.json({
        success: true,
        message: 'Password updated successfully.',
        token: freshToken,
        user: sanitizeUser(updated, { includeBillNumber: true, includeContact: true })
    });
}

function getCurrentUser(req, res) {
    return res.json({
        success: true,
        user: sanitizeUser(req.user, { includeBillNumber: true, includeContact: true })
    });
}

module.exports = {
    getPublicConfig,
    getAllUsers,
    getDemoAccounts,
    demoLogin,
    login,
    changePassword,
    getCurrentUser
};
