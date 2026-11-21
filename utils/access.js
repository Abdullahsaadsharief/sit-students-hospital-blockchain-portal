/**
 * Centralized Clinical Authorization Helper (Phase 3 / F-04)
 * Enforces consistent role & resource ownership rules across all clinical endpoints.
 */

function isReportDeleted(report) {
    return Boolean(report && report.deletedAt);
}

/**
 * Can this authenticated user view/download/verify-rich/QR a specific medical report?
 * Matrix:
 *   - Patient: own non-deleted reports only
 *   - Doctor: all non-deleted hospital reports (assigned-care scoping deferred)
 *   - Admin: allowed (caller should audit-log ADMIN_CLINICAL_ACCESS)
 *   - Lab Staff: NO (restricted to upload queue)
 *   - Receptionist: NO (restricted to demographics & billing)
 */
function canViewReport(user, report) {
    if (!user || !report || isReportDeleted(report)) return false;

    if (user.role === 'Patient') {
        return report.patientId === user.id || (Boolean(user.patientId) && report.patientPseudonym === user.patientId);
    }
    if (user.role === 'Doctor' || user.role === 'Admin') {
        return true;
    }
    return false;
}

/**
 * Can this authenticated user view records/timeline/prescriptions for a given patientId?
 */
function canViewPatientRecords(user, targetPatientId) {
    if (!user || !targetPatientId) return false;

    if (user.role === 'Patient') {
        return targetPatientId === user.id || (Boolean(user.patientId) && targetPatientId === user.patientId);
    }
    if (user.role === 'Doctor' || user.role === 'Admin') {
        return true;
    }
    return false;
}

/**
 * Can this authenticated user create an external expiring share link for a report?
 */
function canShareReport(user, report) {
    if (!user || !report || isReportDeleted(report)) return false;

    if (user.role === 'Patient') {
        return report.patientId === user.id || (Boolean(user.patientId) && report.patientPseudonym === user.patientId);
    }
    if (user.role === 'Doctor' || user.role === 'Admin') {
        return true;
    }
    return false;
}

/**
 * Can this authenticated user view/download a specific doctor prescription or its attachment?
 */
function canViewPrescription(user, prescription) {
    if (!user || !prescription) return false;

    if (user.role === 'Patient') {
        return prescription.patientId === user.id || (Boolean(user.patientId) && prescription.patientUhid === user.patientId);
    }
    if (user.role === 'Doctor' || user.role === 'Admin') {
        return true;
    }
    return false;
}

/**
 * Can this authenticated user download a patient's OPD Reception Bill PDF?
 */
function canViewPatientBill(user, patient) {
    if (!user || !patient) return false;
    if (user.role === 'Receptionist' || user.role === 'Admin') return true;
    if (user.role === 'Patient') {
        return patient.id === user.id || (Boolean(user.patientId) && patient.patientId === user.patientId);
    }
    return false;
}

module.exports = {
    isReportDeleted,
    canViewReport,
    canViewPatientRecords,
    canShareReport,
    canViewPrescription,
    canViewPatientBill
};
