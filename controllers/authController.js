const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { JWT_SECRET, sanitizeUser } = require('../middleware/authMiddleware');

function getAllUsers(req, res) {
    // Only expose billNumbers if caller provides a valid staff JWT token
    let isAuthorizedStaff = false;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
            if (decoded && ['Doctor', 'Lab Staff', 'Receptionist', 'Admin'].includes(decoded.role)) {
                isAuthorizedStaff = true;
            }
        } catch (e) {}
    }

    const users = db.getAllUsers().map(u => sanitizeUser(u, isAuthorizedStaff));
    return res.json({ success: true, users });
}

function login(req, res) {
    const { userId, email, password, billNumber } = req.body;
    let user = null;

    if (userId) {
        user = db.findUserById(userId);
    }

    // Check if logging in via Bill Number / Reception ID (Passwordless Patient Login ONLY)
    const lookupBill = (billNumber || '').trim();
    if (!user && lookupBill) {
        const cleanBill = lookupBill.toLowerCase();
        user = db.getAllUsers().find(u =>
            u.role === 'Patient' && (
                (u.billNumber && u.billNumber.toLowerCase() === cleanBill) ||
                (u.receptionId && u.receptionId.toLowerCase() === cleanBill) ||
                (u.patientId && u.patientId.toLowerCase() === cleanBill)
            )
        );
    }

    if (!user && email) {
        const cleanInput = String(email).trim().toLowerCase();
        user = db.findUserByEmail(cleanInput);
        if (!user) {
            user = db.getAllUsers().find(u =>
                (u.email && u.email.toLowerCase() === cleanInput) ||
                (u.id && u.id.toLowerCase() === cleanInput) ||
                (u.patientId && u.patientId.toLowerCase() === cleanInput)
            );
        }
    }

    if (!user) {
        return res.status(404).json({
            success: false,
            message: lookupBill
                ? `No patient found with Bill / Reception ID "${lookupBill}". Please check the Bill Number issued by the Receptionist.`
                : 'User identity not found in SIT Students Hospital database.'
        });
    }

    // SECURITY PATCH:
    // 1. Only Patients logging in via lookupBill (or one-click demo userId) bypass password check.
    // 2. Any login attempt via email/username MUST provide a valid non-empty password matching userPass!
    const isPasswordlessPatientBillLogin = Boolean(user.role === 'Patient' && lookupBill);
    const isDemoCardQuickLogin = Boolean(userId && !email && !password);

    if (!isPasswordlessPatientBillLogin && !isDemoCardQuickLogin) {
        const userPass = user.password || user.passwordHash || 'password123';
        if (!password || String(password) !== String(userPass)) {
            db.logAudit('FAILED_LOGIN_ATTEMPT', user.name, `Failed password verification for ${user.email} (${user.role})`);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials. Password verification failed.'
            });
        }
    }

    const token = jwt.sign(
        {
            id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
            patientId: user.patientId || null,
            billNumber: user.billNumber || null
        },
        JWT_SECRET,
        { expiresIn: '12h' }
    );

    db.logAudit(
        'USER_LOGIN',
        user.name,
        isPasswordlessPatientBillLogin
            ? `Patient accessed portal via Reception Bill ID (${user.billNumber || user.patientId})`
            : `User authenticated successfully with role: ${user.role}`
    );

    return res.json({
        success: true,
        message: `Welcome, ${user.name}!`,
        token,
        user: sanitizeUser(user, true)
    });
}

function getCurrentUser(req, res) {
    return res.json({
        success: true,
        user: sanitizeUser(req.user, true)
    });
}

module.exports = {
    getAllUsers,
    login,
    getCurrentUser
};
