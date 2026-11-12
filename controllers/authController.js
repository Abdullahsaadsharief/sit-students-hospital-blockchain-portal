const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

function getAllUsers(req, res) {
    const users = db.getAllUsers();
    return res.json({ success: true, users });
}

function login(req, res) {
    const { userId, email, password, billNumber } = req.body;
    let user = null;

    if (userId) {
        user = db.findUserById(userId);
    }

    // Check if logging in via Bill Number / Reception ID (Passwordless Patient Login)
    const lookupBill = (billNumber || '').trim();
    if (!user && lookupBill) {
        const cleanBill = lookupBill.toLowerCase();
        user = db.getAllUsers().find(u =>
            u.role === 'Patient' && (
                (u.billNumber && u.billNumber.toLowerCase() === cleanBill) ||
                (u.receptionId && u.receptionId.toLowerCase() === cleanBill) ||
                (u.patientId && u.patientId.toLowerCase() === cleanBill) ||
                (u.billNumber && u.billNumber.toLowerCase().endsWith('-' + cleanBill))
            )
        );
    }

    if (!user && email) {
        const cleanInput = email.trim().toLowerCase();
        user = db.findUserByEmail(cleanInput);
        if (!user) {
            // Also check by billNumber, receptionId, patientId, or userId
            user = db.getAllUsers().find(u =>
                (u.email && u.email.toLowerCase() === cleanInput) ||
                (u.id && u.id.toLowerCase() === cleanInput) ||
                (u.patientId && u.patientId.toLowerCase() === cleanInput) ||
                (u.billNumber && u.billNumber.toLowerCase() === cleanInput) ||
                (u.receptionId && u.receptionId.toLowerCase() === cleanInput)
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

    // Patients logging in via Bill Number / Reception ID do NOT need a password
    const isPasswordlessPatientLogin = Boolean(
        user.role === 'Patient' && (lookupBill || !password)
    );

    if (!isPasswordlessPatientLogin && !userId) {
        const userPass = user.password || 'password123';
        if (password && password !== userPass) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. Password verification failed.' });
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
        isPasswordlessPatientLogin
            ? `Patient accessed portal via Reception Bill ID (${user.billNumber || user.patientId})`
            : `User authenticated successfully with role: ${user.role}`
    );

    return res.json({
        success: true,
        message: `Welcome, ${user.name}!`,
        token,
        user
    });
}

function getCurrentUser(req, res) {
    return res.json({
        success: true,
        user: req.user
    });
}

module.exports = {
    getAllUsers,
    login,
    getCurrentUser
};
