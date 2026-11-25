// HealthChain Medical Consortium Client Engine
let currentUser = null;
let authToken = localStorage.getItem('hc_auth_token') || null;

let allReportsCache = [];
let allPatientsCache = [];
let selectedDoctorPatientId = null;
let activeTagFilter = '';
let currentVerificationUrl = '';
let currentShareUrl = '';
let currentModalPdfBlobUrl = null;
let serverPublicConfig = { demoMode: false, blockchain: null };

// Registered role definitions for quick demo switching
const USERS_MAP = {
    'usr_doc_01': {
        id: 'usr_doc_01',
        name: 'Dr. Sarah Rao',
        role: 'Doctor',
        desc: 'Cardiology & General Medicine • SIT Students Hospital',
        avatar: '👨‍⚕️'
    },
    'usr_doc_02': {
        id: 'usr_doc_02',
        name: 'Dr. Rajesh Nair',
        role: 'Doctor',
        desc: 'Orthopedics & Trauma Wing • SIT Students Hospital',
        avatar: '👨‍⚕️'
    },
    'usr_doc_03': {
        id: 'usr_doc_03',
        name: 'Dr. Ananya Sen',
        role: 'Doctor',
        desc: 'Pulmonology & Respiratory Wing • SIT Students Hospital',
        avatar: '👩‍⚕️'
    },
    'usr_doc_04': {
        id: 'usr_doc_04',
        name: 'Dr. Vikram Mehta',
        role: 'Doctor',
        desc: 'Neurology & Spine Wing • SIT Students Hospital',
        avatar: '👨‍⚕️'
    },
    'usr_lab_01': {
        id: 'usr_lab_01',
        name: 'Alex Smith',
        role: 'Lab Staff',
        desc: 'Senior Technologist • SIT Central Pathology Lab',
        avatar: '🔬'
    },
    'usr_pat_01': {
        id: 'usr_pat_01',
        name: 'John Doe',
        role: 'Patient',
        patientId: 'PT-9901',
        desc: 'SIT Hospital Patient ID: PT-9901 • Age: 48 • Blood Group: O+',
        avatar: '👤'
    },
    'usr_pat_02': {
        id: 'usr_pat_02',
        name: 'Meera Patel',
        role: 'Patient',
        patientId: 'PT-9902',
        desc: 'SIT Hospital Patient ID: PT-9902 • Age: 34 • Blood Group: B+',
        avatar: '👩'
    },
    'usr_pat_03': {
        id: 'usr_pat_03',
        name: 'Robert Chen',
        role: 'Patient',
        patientId: 'PT-9903',
        desc: 'SIT Hospital Patient ID: PT-9903 • Age: 54 • Blood Group: A+',
        avatar: '👨'
    },
    'usr_pat_04': {
        id: 'usr_pat_04',
        name: 'Ayesha Khan',
        role: 'Patient',
        patientId: 'PT-9904',
        desc: 'SIT Hospital Patient ID: PT-9904 • Age: 29 • Blood Group: AB+',
        avatar: '👩'
    },
    'usr_adm_01': {
        id: 'usr_adm_01',
        name: 'Hospital IT Admin',
        role: 'Admin',
        desc: 'SIT Students Hospital Administration & Settings',
        avatar: '🛡️'
    }
};

// ==========================================================================
// 1. INITIALIZATION & SESSION RESTORATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    initPortalTheme();
    initTabs();
    initUploadDropzone();
    initSearch();
    initFormListeners();

    await loadPublicServerConfig();

    // Check if session exists in localStorage
    const savedUserStr = localStorage.getItem('hc_current_user');
    if (authToken && savedUserStr) {
        try {
            const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
            if (res.ok) {
                const meData = await res.json();
                applySession(authToken, meData.user);
            } else {
                showLoginScreen();
            }
        } catch (e) {
            showLoginScreen();
        }
    } else {
        showLoginScreen();
    }

    const dateInput = document.getElementById('uploadDate');
    if (dateInput) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
});

async function loadPublicServerConfig() {
    try {
        const res = await fetch('/api/config/public');
        if (res.ok) {
            const data = await res.json();
            serverPublicConfig = data;
            const isDemo = Boolean(data.demoMode);
            const tabQuick = document.getElementById('tabQuickLogin');
            const demoKit = document.getElementById('demoReportsKitCard');
            const btnTamper = document.getElementById('btnDemoTamperChain');
            const btnRestore = document.getElementById('btnDemoRestoreChain');

            if (tabQuick) tabQuick.style.display = isDemo ? 'inline-flex' : 'none';
            if (demoKit) demoKit.style.display = isDemo ? 'block' : 'none';
            if (btnTamper) btnTamper.style.display = isDemo ? 'inline-flex' : 'none';
            if (btnRestore) btnRestore.style.display = isDemo ? 'inline-flex' : 'none';

            if (isDemo) {
                switchLoginMode('quick');
            } else {
                switchLoginMode('creds');
            }
            updateEthereumStatusBanner(data.blockchain);
        }
    } catch (e) {
        switchLoginMode('creds');
    }
}

function updateEthereumStatusBanner(eth) {
    const textEl = document.getElementById('ethereumBlockchainStatusText');
    if (!textEl || !eth) return;
    if (eth.onChainEnabled) {
        const link = eth.contractExplorerLink
            ? ` • <a href="${escapeHtml(eth.contractExplorerLink)}" target="_blank" rel="noreferrer" style="color: var(--accent-cyan); font-weight: 700;">View Smart Contract on Explorer ↗</a>`
            : '';
        textEl.innerHTML = `<strong>Live Ethereum EVM Connected:</strong> ${escapeHtml(eth.mode)} • Contract: <code>${escapeHtml(eth.contractAddress)}</code>${link}`;
    } else {
        textEl.innerHTML = `<strong>Local Tamper-Evident Hash-Chain Mode:</strong> Live Ethereum Sepolia RPC/Contract not yet configured in <code>.env</code>. Run <code>npm run deploy:blockchain</code> to anchor reports on-chain.`;
    }
}

function getAuthHeaders() {
    const headers = {};
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
}

// ==========================================================================
// 2. AUTHENTICATION & LOGIN GATE LOGIC
// ==========================================================================
function switchLoginMode(mode) {
    const quickTab = document.getElementById('tabQuickLogin');
    const billTab = document.getElementById('tabBillLogin');
    const credsTab = document.getElementById('tabCredsLogin');
    const quickView = document.getElementById('quickLoginView');
    const billView = document.getElementById('billLoginView');
    const credsView = document.getElementById('credsLoginView');

    if (mode === 'quick' && !serverPublicConfig.demoMode) {
        mode = 'creds';
    }

    if (quickTab) quickTab.classList.toggle('active', mode === 'quick');
    if (billTab) billTab.classList.toggle('active', mode === 'bill');
    if (credsTab) credsTab.classList.toggle('active', mode === 'creds');

    if (quickView) quickView.style.display = mode === 'quick' ? 'block' : 'none';
    if (billView) billView.style.display = mode === 'bill' ? 'block' : 'none';
    if (credsView) credsView.style.display = mode === 'creds' ? 'block' : 'none';
}

async function loginWithBillAndSecret(billNumber, secret, isAccessCode = true) {
    const cleanBill = (billNumber || '').trim();
    const cleanSecret = (secret || '').trim();
    if (!cleanBill || !cleanSecret) {
        alert('Please enter both your Reception Bill Number and your 8-character Access Code (or personal password).');
        return;
    }
    try {
        const body = isAccessCode
            ? { billNumber: cleanBill, accessCode: cleanSecret }
            : { billNumber: cleanBill, password: cleanSecret };

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert(data.message || 'Invalid Bill Number or Access Code.');
            return;
        }
        applySession(data.token, data.user);
    } catch (err) {
        alert('Patient login error: ' + err.message);
    }
}

async function loginAsDemoReceptionist() {
    if (!serverPublicConfig.demoMode) {
        alert('One-click demo sign-in is disabled in hardened mode.');
        return;
    }
    try {
        const res = await fetch('/api/auth/demo-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'usr_rec_01' })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert(data.message || 'Demo Receptionist sign-in failed.');
            return;
        }
        localStorage.setItem('sit_rec_token', data.token);
        localStorage.setItem('sit_rec_user', JSON.stringify(data.user));
        window.location.href = '/reception';
    } catch (err) {
        alert('Login error: ' + err.message);
    }
}

async function loginAsRole(userId) {
    if (!serverPublicConfig.demoMode) {
        alert('One-click demo sign-in is disabled in hardened mode. Please sign in with credentials.');
        return;
    }
    try {
        const res = await fetch('/api/auth/demo-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            alert('Demo authentication failed: ' + (data.message || 'Unknown error'));
            return;
        }

        applySession(data.token, data.user);
    } catch (err) {
        alert('Login communication error: ' + err.message);
    }
}

async function loginWithCredentials(emailOrId, password) {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: emailOrId, password })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            alert('Authentication failed: ' + (data.message || 'Invalid credentials'));
            return;
        }

        applySession(data.token, data.user);
    } catch (err) {
        alert('Login communication error: ' + err.message);
    }
}

function openChangePasswordModal(forced = false) {
    const modal = document.getElementById('changePasswordModal');
    const curGroup = document.getElementById('currentPasswordGroup');
    const desc = document.getElementById('changePasswordModalDesc');
    if (curGroup) curGroup.style.display = forced ? 'none' : 'block';
    if (desc) {
        desc.textContent = forced
            ? 'First-time or reset sign-in detected. Please set a private password (minimum 10 characters) to unlock your hospital portal.'
            : 'Update your account password (minimum 10 characters).';
    }
    if (modal) modal.classList.add('active');
}

function applySession(token, user) {
    authToken = token;
    currentUser = user;
    selectedDoctorPatientId = null;
    localStorage.setItem('hc_auth_token', token);
    localStorage.setItem('hc_current_user', JSON.stringify(user));

    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';

    updateUserDisplay(user);
    applyRolePermissions(user.role);

    if (user.mustChangePassword) {
        openChangePasswordModal(true);
        return;
    }

    if (user.role !== 'Patient') {
        loadStats();
        refreshConsortiumUsers();
    }
    if (user.role === 'Lab Staff') {
        loadLabRequestsQueue();
    } else if (user.role === 'Patient') {
        loadReports();
        loadTimeline();
        loadPrescriptions();
    } else {
        loadReports();
        loadTimeline();
        loadPrescriptions();
        loadLabRequestsQueue();
        if (user.role === 'Admin') {
            loadBlockchain();
            loadAuditLogs();
            loadAdminUsers();
        }
    }
}

async function refreshConsortiumUsers() {
    try {
        const res = await fetch('/api/auth/users', { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.users) {
                populatePatientDropdowns(data.users);
            }
        }
    } catch (e) {
        console.warn('Failed to refresh consortium users:', e);
    }
}

function updateUserDisplay(user) {
    const avatar = user.role === 'Doctor' ? '👨‍⚕️' : user.role === 'Lab Staff' ? '🔬' : user.role === 'Admin' ? '🛡️' : '👤';
    
    // Header Identity
    const headerAvatar = document.getElementById('headerUserAvatar');
    const headerName = document.getElementById('headerUserName');
    const headerRole = document.getElementById('headerUserRoleBadge');
    if (headerAvatar) headerAvatar.textContent = avatar;
    if (headerName) headerName.textContent = user.name;
    if (headerRole) headerRole.textContent = user.role.toUpperCase();

    // Banner Identity
    const bannerAvatar = document.getElementById('userAvatar');
    const bannerName = document.getElementById('userNameDisplay');
    const bannerRole = document.getElementById('userRoleDisplay');
    if (bannerAvatar) bannerAvatar.textContent = avatar;
    if (bannerName) bannerName.textContent = user.name;
    
    let desc = user.role;
    if (user.department) desc += ` • ${user.department}`;
    if (user.hospital) desc += ` • ${user.hospital}`;
    if (user.laboratory) desc += ` • ${user.laboratory}`;
    if (user.patientId) desc += ` • UHID: ${user.patientId}`;
    if (user.billNumber) desc += ` • Bill No: ${user.billNumber}`;
    if (user.assignedDoctor) desc += ` • Assigned Doctor: ${user.assignedDoctor}`;
    if (bannerRole) bannerRole.textContent = desc;

    // Highlight Role Switcher button
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-user-id') === user.id);
    });
}

function showLoginScreen() {
    currentUser = null;
    authToken = null;
    localStorage.removeItem('hc_auth_token');
    localStorage.removeItem('hc_current_user');

    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
}

function logout() {
    showLoginScreen();
}

async function switchUserRole(userId) {
    await loginAsRole(userId);
}

// ==========================================================================
// 3. ROLE-BASED ACCESS CONTROL (RBAC) RESTRICTIONS
// ==========================================================================
function applyRolePermissions(role) {
    const tabRecords = document.getElementById('tabNavRecords');
    const tabPrescriptions = document.getElementById('tabNavPrescriptions');
    const tabTimeline = document.getElementById('tabNavTimeline');
    const tabUpload = document.getElementById('tabNavUpload');
    const tabReception = document.getElementById('tabNavReception');
    const tabAdmin = document.getElementById('tabNavAdmin');
    const tabBlockchain = document.getElementById('tabNavBlockchain');
    const tabAudit = document.getElementById('tabNavAudit');

    const patientNotice = document.getElementById('patientScopedNotice');
    const uploadRestrictedNotice = document.getElementById('uploadRestrictedNotice');
    const uploadForm = document.getElementById('uploadForm');
    const timelinePatientSelectorWrapper = document.getElementById('timelinePatientSelectorWrapper');
    const doctorRxFormCard = document.getElementById('doctorPrescriptionFormCard');

    // Reset default display
    if (tabRecords) tabRecords.style.display = 'inline-flex';
    if (tabPrescriptions) tabPrescriptions.style.display = 'inline-flex';
    if (tabTimeline) tabTimeline.style.display = 'inline-flex';
    if (tabUpload) tabUpload.style.display = 'inline-flex';
    if (tabReception) tabReception.style.display = 'inline-flex';
    if (tabAdmin) tabAdmin.style.display = 'none';
    if (tabBlockchain) tabBlockchain.style.display = 'inline-flex';
    if (tabAudit) tabAudit.style.display = 'inline-flex';

    if (patientNotice) patientNotice.style.display = 'none';
    if (uploadRestrictedNotice) uploadRestrictedNotice.style.display = 'none';
    if (uploadForm) uploadForm.style.opacity = '1';
    if (timelinePatientSelectorWrapper) timelinePatientSelectorWrapper.style.display = 'flex';
    if (doctorRxFormCard) doctorRxFormCard.style.display = 'block';

    if (role === 'Patient') {
        // Patient sees ONLY their own reports, doctor checkup prescriptions, and medical timeline
        if (tabUpload) tabUpload.style.display = 'none';
        if (tabReception) tabReception.style.display = 'none';
        if (tabAdmin) tabAdmin.style.display = 'none';
        if (tabBlockchain) tabBlockchain.style.display = 'none';
        if (tabAudit) tabAudit.style.display = 'none';
        if (doctorRxFormCard) doctorRxFormCard.style.display = 'none';

        if (patientNotice) patientNotice.style.display = 'flex';
        if (timelinePatientSelectorWrapper) timelinePatientSelectorWrapper.style.display = 'none';

        if (tabRecords) tabRecords.click();

    } else if (role === 'Lab Staff') {
        // STRICT LAB STAFF PRIVACY: Lab Staff can ONLY see the Lab Upload & Ordered Test Queue tab!
        // They CANNOT browse patients' previous diagnostic reports, timelines, prescriptions, ledger, or audit logs.
        if (tabRecords) tabRecords.style.display = 'none';
        if (tabPrescriptions) tabPrescriptions.style.display = 'none';
        if (tabTimeline) tabTimeline.style.display = 'none';
        if (tabReception) tabReception.style.display = 'none';
        if (tabAdmin) tabAdmin.style.display = 'none';
        if (tabBlockchain) tabBlockchain.style.display = 'none';
        if (tabAudit) tabAudit.style.display = 'none';

        if (uploadRestrictedNotice) uploadRestrictedNotice.style.display = 'none';
        if (tabUpload) tabUpload.click();

    } else if (role === 'Doctor') {
        // Doctor sees ONLY clinical tabs (Patient Medical Records, Checkup & Prescriptions, Patient Timeline)
        // Hospital Ledger, Audit Logs, Reception Settings, Lab Upload, and Admin Directory are hidden for Doctors
        if (tabAdmin) tabAdmin.style.display = 'none';
        if (tabUpload) tabUpload.style.display = 'none';
        if (tabReception) tabReception.style.display = 'none';
        if (tabBlockchain) tabBlockchain.style.display = 'none';
        if (tabAudit) tabAudit.style.display = 'none';
        if (doctorRxFormCard) doctorRxFormCard.style.display = 'block';

        updateDoctorPatientGateUI();
        if (tabRecords) tabRecords.click();

    } else if (role === 'Admin') {
        updateDoctorPatientGateUI();
        if (tabAdmin) tabAdmin.style.display = 'inline-flex';
        if (tabAdmin) tabAdmin.click();
    }
    if (role !== 'Doctor') {
        updateDoctorPatientGateUI();
    }
}

// ==========================================================================
// 4. TAB NAVIGATION
// ==========================================================================
function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');

            if (targetId === 'blockchainTab') loadBlockchain();
            if (targetId === 'auditTab') loadAuditLogs();
            if (targetId === 'timelineTab') loadTimeline();
            if (targetId === 'adminTab') loadAdminUsers();
            if (targetId === 'recordsTab') loadReports();
        });
    });
}

// ==========================================================================
// 5. STATS & SYSTEM METRICS
// ==========================================================================
async function loadStats() {
    try {
        const res = await fetch('/api/blockchain/stats', { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success && data.stats) {
            document.getElementById('metricReports').textContent = data.stats.totalReports;
            document.getElementById('metricBlocks').textContent = data.stats.totalBlocks;
            document.getElementById('metricDuplicates').textContent = data.stats.duplicatesPrevented;
            
            const statusEl = document.getElementById('metricChainStatus');
            if (data.stats.isBlockchainValid) {
                statusEl.textContent = 'VALID';
                statusEl.className = 'metric-value status-valid';
                statusEl.style.color = '';
            } else {
                statusEl.textContent = 'TAMPERED';
                statusEl.className = 'metric-value status-tampered';
                statusEl.style.color = '';
            }
        }
    } catch (e) {
        console.warn('Failed to load stats:', e.message);
    }
}

// ==========================================================================
// 6. MEDICAL REPORTS ARCHIVE & OCR SEARCH
// ==========================================================================
async function loadReports() {
    try {
        const res = await fetch('/api/reports', { headers: getAuthHeaders() });
        if (res.status === 401) {
            logout();
            return;
        }
        const data = await res.json();
        if (data.success) {
            allReportsCache = data.reports || [];
            updateDoctorPatientGateUI();
            renderReports(getVisibleReportsForCurrentView());
        }
    } catch (err) {
        console.error('Error loading reports:', err);
    }
}

function getVisibleReportsForCurrentView() {
    if (currentUser && (currentUser.role === 'Doctor' || currentUser.role === 'Admin')) {
        if (!selectedDoctorPatientId) {
            return [];
        }
        return allReportsCache.filter(r => r.patientId === selectedDoctorPatientId || r.patientPseudonym === selectedDoctorPatientId);
    }
    return allReportsCache;
}

function updateDoctorPatientGateUI() {
    const gateEl = document.getElementById('doctorPatientSelectorGate');
    const bannerEl = document.getElementById('doctorActivePatientBanner');
    const archiveCard = document.getElementById('reportsArchiveCard');
    const badgeEl = document.getElementById('recordsCountBadge');

    if (!currentUser || (currentUser.role !== 'Doctor' && currentUser.role !== 'Admin')) {
        if (gateEl) gateEl.style.display = 'none';
        if (bannerEl) bannerEl.style.display = 'none';
        if (archiveCard) archiveCard.style.display = 'block';
        if (badgeEl) badgeEl.textContent = allReportsCache.length;
        return;
    }

    // For Doctor: check if a patient has been selected
    if (!selectedDoctorPatientId) {
        if (gateEl) gateEl.style.display = 'block';
        if (bannerEl) bannerEl.style.display = 'none';
        if (archiveCard) archiveCard.style.display = 'none';
        if (badgeEl) badgeEl.textContent = allPatientsCache.length + ' Patients';
        renderDoctorPatientDirectory(document.getElementById('doctorPatientSearchInput')?.value || '');
    } else {
        if (gateEl) gateEl.style.display = 'none';
        if (bannerEl) bannerEl.style.display = 'block';
        if (archiveCard) archiveCard.style.display = 'block';

        const pat = allPatientsCache.find(p => p.id === selectedDoctorPatientId);
        const patReports = getVisibleReportsForCurrentView();
        if (badgeEl) badgeEl.textContent = patReports.length;

        if (pat) {
            const nameEl = document.getElementById('activePatBannerName');
            const metaEl = document.getElementById('activePatBannerMeta');
            const titleEl = document.getElementById('reportsArchiveTitle');
            if (nameEl) nameEl.textContent = `${pat.name} (${pat.patientId || pat.id})`;
            if (metaEl) metaEl.textContent = `Bill No: ${pat.billNumber || 'N/A'} • Age: ${pat.age || '-'} Y / ${pat.gender || '-'} • Blood Group: ${pat.bloodGroup || 'O+'} • Contact: ${pat.contact || '-'} • ${patReports.length} Diagnostic Report(s)`;
            if (titleEl) titleEl.textContent = `Diagnostic Reports for ${pat.name} (${pat.patientId})`;
        }
    }
}

function renderDoctorPatientDirectory(filterQuery = '') {
    const grid = document.getElementById('doctorPatientCardsGrid');
    if (!grid) return;

    const q = (filterQuery || '').toLowerCase().trim();
    const filteredPatients = allPatientsCache.filter(p => {
        if (!q) return true;
        return (
            (p.name && p.name.toLowerCase().includes(q)) ||
            (p.patientId && p.patientId.toLowerCase().includes(q)) ||
            (p.billNumber && p.billNumber.toLowerCase().includes(q))
        );
    });

    if (filteredPatients.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-muted);">No matching patient found for "${escapeHtml(filterQuery)}".</div>`;
        return;
    }

    grid.innerHTML = filteredPatients.map(p => {
        const reportCount = allReportsCache.filter(r => r.patientId === p.id || r.patientPseudonym === p.patientId).length;
        return `
            <div class="patient-select-card" onclick="selectDoctorPatient('${escapeHtml(p.id)}')">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem;">
                    <span class="report-id-badge">${escapeHtml(p.patientId || p.id)}</span>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 700; color: var(--accent-teal);">${escapeHtml(p.billNumber || '')}</span>
                </div>
                <h4 style="font-size: 1.05rem; margin-bottom: 0.25rem; color: var(--text-primary);">${escapeHtml(p.name)}</h4>
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 0.65rem;">
                    Age: <strong>${escapeHtml(p.age || '-')} Y</strong> • ${escapeHtml(p.gender || '-')} • Blood: <strong>${escapeHtml(p.bloodGroup || 'O+')}</strong><br/>
                    <span style="font-size: 0.76rem; color: var(--text-muted);">Diagnostic Reports on File: <strong>${reportCount}</strong></span>
                </div>
                <button type="button" class="btn btn-primary" style="width: 100%; font-size: 0.8rem; padding: 7px 12px;">
                    📂 Open Patient Medical File &rarr;
                </button>
            </div>
        `;
    }).join('');
}

function selectDoctorPatient(patientId) {
    selectedDoctorPatientId = patientId;
    const quickDropdown = document.getElementById('doctorQuickPatientDropdown');
    if (quickDropdown) quickDropdown.value = patientId;

    // Also sync Timeline and Checkup Prescription dropdowns to this patient
    const timelineSelect = document.getElementById('timelinePatientSelect');
    if (timelineSelect) {
        timelineSelect.value = patientId;
        loadTimeline();
    }
    const rxSelect = document.getElementById('rxPatientSelect');
    if (rxSelect) {
        rxSelect.value = patientId;
    }

    updateDoctorPatientGateUI();
    renderReports(getVisibleReportsForCurrentView());
    loadPrescriptions();
}

function clearDoctorSelectedPatient() {
    selectedDoctorPatientId = null;
    const quickDropdown = document.getElementById('doctorQuickPatientDropdown');
    if (quickDropdown) quickDropdown.value = '';
    updateDoctorPatientGateUI();
}

function openCheckupForSelectedPatient() {
    if (selectedDoctorPatientId) {
        const rxSelect = document.getElementById('rxPatientSelect');
        if (rxSelect) rxSelect.value = selectedDoctorPatientId;
    }
    const tabRx = document.getElementById('tabNavPrescriptions');
    if (tabRx) tabRx.click();
}

function renderReports(reports) {
    const grid = document.getElementById('reportsGrid');
    grid.innerHTML = '';

    let filtered = reports;
    if (activeTagFilter) {
        filtered = filtered.filter(r => 
            (r.keywords && r.keywords.some(k => k.toLowerCase().includes(activeTagFilter.toLowerCase()))) ||
            (r.title && r.title.toLowerCase().includes(activeTagFilter.toLowerCase()))
        );
    }

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📁</div>
                <h4>No diagnostic records found</h4>
                <p style="font-size: 0.85rem;">Try changing your filter keyword or upload a new test report.</p>
            </div>
        `;
        return;
    }

    const isDoctorOrAdmin = currentUser && (currentUser.role === 'Doctor' || currentUser.role === 'Admin');
    const canDelete = currentUser && currentUser.role === 'Admin';

    filtered.forEach(r => {
        const card = document.createElement('div');
        card.className = 'report-card';

        const tagsHtml = (r.keywords || []).slice(0, 4).map(k => `<span class="tag-badge">${escapeHtml(k)}</span>`).join('');

        // Doctor diagnosis remarks badge if present
        let remarksBadge = '';
        if (r.doctorRemarks) {
            const notesCount = Array.isArray(r.sharedDoctorNotes) ? r.sharedDoctorNotes.length : 1;
            remarksBadge = `
                <div class="report-eval-box">
                    👨‍⚕️ <strong>Clinical Evaluation (${notesCount} Doctor${notesCount > 1 ? 's' : ''}):</strong> ${escapeHtml(r.doctorRemarks.status || 'Reviewed')} • ${escapeHtml(r.doctorRemarks.doctorName || '')}
                </div>
            `;
        }

        // Action buttons tailored by role
        let editBtnHtml = '';
        if (isDoctorOrAdmin) {
            editBtnHtml = `
                <button class="btn btn-edit" onclick="openEditReportModal('${escapeHtml(r.reportId)}')">
                    ✏️ Add Doctor Note
                </button>
            `;
        }

        let deleteBtnHtml = '';
        if (canDelete) {
            deleteBtnHtml = `
                <button class="btn btn-delete" onclick="confirmDeleteReport('${escapeHtml(r.reportId)}', '${escapeHtml(r.title)}')" title="Delete test report from hospital registry">
                    🗑️ Delete
                </button>
            `;
        }

        let aiBadgeHtml = '';
        if (r.aiHighlights && (r.aiHighlights.keyFindings || r.aiHighlights.diagnosticImpression)) {
            const keyBullets = (r.aiHighlights.keyFindings || []).slice(0, 2);
            aiBadgeHtml = `
                <div class="report-ai-box">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                        <strong class="report-ai-title">🤖 Clinical Key Findings:</strong>
                        <span style="font-size: 0.68rem; color: var(--accent-cyan); font-weight: 700;">${escapeHtml(r.aiHighlights.aiEngine || 'Clinical Rule Engine')}</span>
                    </div>
                    ${keyBullets.map(b => `<div class="report-ai-bullet">• ${escapeHtml(b)}</div>`).join('')}
                </div>
            `;
        }

        card.innerHTML = `
            <div>
                <div class="report-card-top">
                    <span class="report-id-badge">${escapeHtml(r.reportId)}</span>
                    <span class="report-date">${escapeHtml(r.testDate || '')}</span>
                </div>
                <h4 class="report-title">${escapeHtml(r.title)}</h4>
                <p class="report-meta">
                    Patient: <strong>${escapeHtml(r.patientName)}</strong> (${escapeHtml(r.patientPseudonym)})<br>
                    <span style="color: var(--text-muted); font-size: 0.78rem;">Anchored on Block #${r.blockIndex} • ${escapeHtml(r.reportType)}</span>
                </p>
                ${aiBadgeHtml}
                ${remarksBadge}
                <div class="report-tags" style="margin-top: 8px;">
                    ${tagsHtml}
                </div>
            </div>


            <div class="report-actions">
                <button class="btn btn-primary" onclick="openReportModal('${escapeHtml(r.reportId)}')">
                    👁️ View Decrypted
                </button>
                <button class="btn btn-secondary" onclick="downloadReportFile('${escapeHtml(r.reportId)}', '${escapeHtml(r.fileName || r.reportId + '.pdf')}')" title="Download Authentic Medical PDF with Embedded QR Code">
                    📥 Download PDF
                </button>
                ${editBtnHtml}
                <button class="btn btn-qr" onclick="openQrModal('${escapeHtml(r.reportId)}')">
                    🔍 Verify QR
                </button>
                <button class="btn btn-share" onclick="openShareModal('${escapeHtml(r.reportId)}', '${escapeHtml(r.title)}')">
                    ⏱️ Share
                </button>
                ${deleteBtnHtml}
            </div>
        `;

        grid.appendChild(card);
    });
}

function initSearch() {
    const input = document.getElementById('reportSearchInput');
    if (!input) return;
    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const baseList = getVisibleReportsForCurrentView();
        if (!query) {
            renderReports(baseList);
            return;
        }

        const filtered = baseList.filter(r => {
            const title = (r.title || '').toLowerCase();
            const patient = (r.patientName || '').toLowerCase();
            const tags = (r.keywords || []).map(k => k.toLowerCase()).join(' ');
            const id = (r.reportId || '').toLowerCase();
            return title.includes(query) || patient.includes(query) || tags.includes(query) || id.includes(query);
        });

        renderReports(filtered);
    });
}

function filterByTag(tag) {
    activeTagFilter = tag;
    document.querySelectorAll('.filter-tag-chip').forEach(c => {
        c.classList.toggle('active', c.textContent.toLowerCase().includes(tag.toLowerCase()) || (!tag && c.textContent.includes('All')));
    });
    renderReports(getVisibleReportsForCurrentView());
}

// ==========================================================================
// 7. CHRONOLOGICAL TIMELINE (Obj 1 & 3)
// ==========================================================================
async function loadTimeline() {
    const patientSelect = document.getElementById('timelinePatientSelect');
    let patientId = patientSelect ? patientSelect.value : 'usr_pat_01';

    if (currentUser && currentUser.role === 'Patient') {
        patientId = currentUser.id;
    }

    const container = document.getElementById('timelineEntries');

    try {
        const res = await fetch(`/api/reports/timeline/${encodeURIComponent(patientId)}`, { headers: getAuthHeaders() });
        const data = await res.json();

        container.innerHTML = '';
        if (!data.success || !data.timeline || data.timeline.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); margin-left: 20px;">No historical records found for this patient.</p>';
            return;
        }

        data.timeline.forEach((item) => {
            const entry = document.createElement('div');
            entry.className = 'timeline-entry';

            const tags = (item.keywords || []).map(k => `<span class="tag-badge">${escapeHtml(k)}</span>`).join('');

            let doctorRemarkHtml = '';
            if (item.doctorRemarks) {
                doctorRemarkHtml = `
                    <div class="timeline-doctor-remark">
                        <strong>Attending Diagnosis:</strong> ${escapeHtml(item.doctorRemarks.status || 'Evaluated')}<br>
                        ${escapeHtml(item.notes || '')}
                    </div>
                `;
            }

            entry.innerHTML = `
                <div class="timeline-node"></div>
                <div class="timeline-card">
                    <div class="timeline-card-header">
                        <div>
                            <span class="report-id-badge">${escapeHtml(item.reportId)}</span>
                            <strong style="margin-left: 8px; font-size: 1.05rem;">${escapeHtml(item.title)}</strong>
                        </div>
                        <span class="timeline-date-badge">📅 Test Date: ${escapeHtml(item.testDate)}</span>
                    </div>
                    ${doctorRemarkHtml || `<p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0.5rem 0;">${escapeHtml(item.notes || 'Routine clinical investigation.')}</p>`}
                    <div style="display: flex; gap: 0.35rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
                        ${tags}
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.75rem;">
                        <span style="font-size: 0.75rem; color: var(--text-muted);">
                            Ledger Anchor: <strong>Block #${item.blockIndex}</strong> (${item.blockHash ? item.blockHash.slice(0, 16) + '...' : ''})
                        </span>
                        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button class="btn btn-secondary" onclick="openReportModal('${escapeHtml(item.reportId)}')">View Report</button>
                            <button class="btn btn-primary" onclick="downloadReportFile('${escapeHtml(item.reportId)}', '${escapeHtml(item.fileName || item.reportId + '.pdf')}')">📥 Download PDF</button>
                            <button class="btn btn-qr" onclick="openQrModal('${escapeHtml(item.reportId)}')">Anti-Forgery QR</button>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(entry);
        });

    } catch (e) {
        console.error('Timeline error:', e);
    }
}

// ==========================================================================
// 8. UPLOAD & DUPLICATE DETECTION (Obj 2 - Lab Staff Only)
// ==========================================================================
let selectedUploadFile = null;

function initUploadDropzone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileNameDisplay = document.getElementById('dropFileName');
    const form = document.getElementById('uploadForm');

    if (!dropZone || !fileInput || !form) return;

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    function handleFileSelect(file) {
        selectedUploadFile = file;
        fileNameDisplay.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        dropZone.style.borderColor = 'var(--accent-cyan)';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (currentUser && currentUser.role !== 'Lab Staff' && currentUser.role !== 'Admin') {
            alert('Access Denied: Only Lab Staff are authorized to upload diagnostic test reports to the consortium.');
            return;
        }

        if (!selectedUploadFile) {
            alert('Please select a medical report file (PDF / PNG / JPG / TXT).');
            return;
        }

        const submitBtn = document.getElementById('submitUploadBtn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Computing SHA-256 & Checking Blockchain...';

        const formData = new FormData();
        formData.append('reportFile', selectedUploadFile);
        formData.append('patientId', document.getElementById('uploadPatient').value);
        formData.append('title', document.getElementById('uploadTitle').value);
        formData.append('reportType', document.getElementById('uploadType').value);
        formData.append('testDate', document.getElementById('uploadDate').value);
        formData.append('notes', document.getElementById('uploadNotes').value);
        formData.append('nodeId', document.getElementById('uploadNode').value);
        const activeReqEl = document.getElementById('activeLabRequestId');
        if (activeReqEl && activeReqEl.value) {
            formData.append('labRequestId', activeReqEl.value);
        }

        try {
            const res = await fetch('/api/reports/upload', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData
            });

            const data = await res.json();

            // Objective 2 Demonstration: DUPLICATE REJECTED
            if (res.status === 409 || data.duplicateDetected) {
                alert(`⚠️ OBJECTIVE 2 ENFORCED: DUPLICATE MEDICAL REPORT DETECTED!\n\n` +
                      `Cryptographic SHA-256 fingerprint:\n${data.fileHash}\n\n` +
                      `This report is already anchored on the blockchain. Redundant upload was blocked to prevent duplicate records and save storage!`);
                loadStats();
                return;
            }

            if (!res.ok) {
                throw new Error(data.message || 'Upload failed');
            }

            alert(`✓ SUCCESS: Report encrypted with AES-256 and anchored to Blockchain Block #${data.block.index}!\n` +
                  `OCR Extracted Tags: [${(data.ocrInfo.extractedKeywords || []).join(', ')}]`);

            form.reset();
            selectedUploadFile = null;
            if (document.getElementById('activeLabRequestId')) {
                document.getElementById('activeLabRequestId').value = '';
            }
            fileNameDisplay.textContent = 'Drag & Drop or Click to Select';
            dropZone.style.borderColor = '';

            loadLabRequestsQueue();
            loadStats();
            if (currentUser && currentUser.role !== 'Lab Staff') {
                loadReports();
                loadTimeline();
            }
            loadBlockchain();

            // Switch to Records tab
            document.getElementById('tabNavRecords').click();

        } catch (err) {
            alert('Upload Error: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '🔒 Encrypt, Detect Duplicates & Anchor on Blockchain';
        }
    });
}

async function simulateDuplicateUpload() {
    const sampleDuplicateContent = `PATIENT DIAGNOSTIC REPORT - METRO APEX HOSPITAL
Patient: John Doe | ID: PT-9901 | Age: 48 | Sex: M
Date of Test: 14-Aug-2026 | Lab Ref: LAB-88910

BIOCHEMISTRY INVESTIGATION:
1. Fasting Blood Sugar (FBS): 142 mg/dL (Normal: 70 - 99 mg/dL) [HIGH]
2. Postprandial Blood Glucose: 198 mg/dL (Normal: < 140 mg/dL) [ELEVATED]
3. Glycated Hemoglobin (HbA1c): 7.4% (Normal: 4.0 - 5.6%) [DIABETIC RANGE]

Impression: Indicative of early Stage-2 Type 2 Diabetes Mellitus.
Recommended: Lifestyle modification, glycemic control follow-up in 90 days.
Signed: Alex Smith, Senior Biochemist`;

    const blob = new Blob([sampleDuplicateContent], { type: 'text/plain' });
    const file = new File([blob], 'Duplicate_Glucose_Report.txt', { type: 'text/plain' });

    const formData = new FormData();
    formData.append('reportFile', file);
    formData.append('patientId', 'usr_pat_01');
    formData.append('title', 'Duplicate Blood Glucose Report');
    formData.append('reportType', 'Pathology / Biochemistry');
    formData.append('testDate', '2026-08-14');
    formData.append('notes', 'Duplicate upload attempt for panel demo');

    try {
        const res = await fetch('/api/reports/upload', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });

        const data = await res.json();

        if (res.status === 409 || data.duplicateDetected) {
            alert(`🛑 OBJECTIVE 2 LIVE VERIFICATION:\n\n` +
                  `STATUS: 409 CONFLICT (Duplicate Detected!)\n` +
                  `SHA-256 Hash: ${data.fileHash.slice(0, 32)}...\n\n` +
                  `The blockchain detected that this diagnostic document already exists. Redundant upload was successfully prevented!`);
            loadStats();
        } else {
            alert('Upload response: ' + JSON.stringify(data));
        }
    } catch (e) {
        alert('Simulated duplicate test failed: ' + e.message);
    }
}

// ==========================================================================
// 9. DOCTOR CLINICAL NOTES EDITING (Doctor Only)
// ==========================================================================
function openEditReportModal(reportId) {
    if (currentUser && currentUser.role !== 'Doctor' && currentUser.role !== 'Admin') {
        alert('Access Denied: Only attending physicians (Doctors) are authorized to edit clinical diagnostic evaluations.');
        return;
    }

    const report = allReportsCache.find(r => r.reportId === reportId);
    if (!report) {
        alert('Report details not found.');
        return;
    }

    document.getElementById('editReportIdInput').value = report.reportId;
    document.getElementById('editReportBadge').textContent = report.reportId;
    document.getElementById('editReportTitle').textContent = `Clinical Evaluation: ${report.title}`;
    document.getElementById('editReportSubtitle').textContent = `Patient: ${report.patientName} (${report.patientPseudonym}) • Date: ${report.testDate}`;
    
    document.getElementById('editReportNotes').value = report.notes || '';
    if (report.doctorRemarks) {
        document.getElementById('editDiagnosisStatus').value = report.doctorRemarks.status || 'Confirmed Diagnosis';
    } else {
        document.getElementById('editDiagnosisStatus').value = 'Confirmed Diagnosis';
    }

    document.getElementById('editReportPrescription').value = report.prescription || '';
    document.getElementById('editReportFollowUp').value = report.followUpDate || '';

    const modal = document.getElementById('editReportModal');
    if (modal) modal.classList.add('active');
}

// ==========================================================================
// 10. ADMIN USER MANAGEMENT (Admin Only)
// ==========================================================================
function updateRoleSpecificFields() {
    const role = document.getElementById('newRoleSelect').value;
    const docFields = document.getElementById('doctorFieldsGroup');
    const patFields = document.getElementById('patientFieldsGroup');
    const labFields = document.getElementById('labFieldsGroup');

    docFields.style.display = role === 'Doctor' ? 'grid' : 'none';
    patFields.style.display = role === 'Patient' ? 'grid' : 'none';
    labFields.style.display = role === 'Lab Staff' ? 'grid' : 'none';
}

async function loadAdminUsers() {
    try {
        const res = await fetch('/api/admin/users', { headers: getAuthHeaders() });
        if (res.status === 403 || res.status === 401) return;
        const data = await res.json();

        if (data.success && data.stats) {
            document.getElementById('statTotalUsers').textContent = data.stats.total;
            document.getElementById('statTotalDoctors').textContent = data.stats.doctors;
            document.getElementById('statTotalPatients').textContent = data.stats.patients;
            document.getElementById('statTotalLabStaff').textContent = data.stats.labStaff;

            renderAdminUsersTable(data.users);
            populatePatientDropdowns(data.users);
        }
        await loadAdminAiConfig();
    } catch (err) {
        console.warn('Failed to load admin users:', err);
    }
}

async function loadAdminAiConfig() {
    try {
        const res = await fetch('/api/admin/ai-config', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        const badge = document.getElementById('adminAiStatusBadge');
        const engineName = document.getElementById('adminAiEngineName');
        const keyStatus = document.getElementById('adminAiKeyStatus');
        const keyInput = document.getElementById('adminGeminiApiKeyInput');

        if (data.status === 'ONLINE_AI') {
            if (badge) {
                badge.className = 'status-pill ai-badge-online';
                badge.removeAttribute('style');
                badge.style.fontSize = '0.72rem';
                badge.style.padding = '2px 8px';
                badge.textContent = '⚡ Google Gemini AI Active';
            }
            if (engineName) {
                engineName.textContent = data.activeEngine;
                engineName.className = 'ai-engine-online';
                engineName.style.color = '';
            }
            if (keyStatus) {
                keyStatus.textContent = `Key: ${data.maskedKey || 'Configured & Active'}`;
                keyStatus.className = 'ai-key-online';
                keyStatus.style.color = '';
            }
            if (keyInput && !keyInput.value) {
                keyInput.placeholder = `Active Key: ${data.maskedKey || 'Configured'} (Enter new key to replace)`;
            }
        } else {
            if (badge) {
                badge.className = 'status-pill ai-badge-offline';
                badge.removeAttribute('style');
                badge.style.fontSize = '0.72rem';
                badge.style.padding = '2px 8px';
                badge.textContent = '🟢 Offline Local NLP Active';
            }
            if (engineName) {
                engineName.textContent = data.activeEngine;
                engineName.className = 'ai-engine-offline';
                engineName.style.color = '';
            }
            if (keyStatus) {
                keyStatus.textContent = data.hasKey && data.maskedKey
                    ? `Key: ${data.maskedKey} (Saved — Click Activate to enable Cloud AI)`
                    : 'Key: Not Configured (Offline Mode Active)';
                keyStatus.className = 'ai-key-offline';
                keyStatus.style.color = '';
            }
            if (keyInput) {
                keyInput.placeholder = data.hasKey && data.maskedKey
                    ? `Saved Key: ${data.maskedKey} (Paste key & click Test & Activate)`
                    : 'Paste Google Gemini API Key (e.g. AIzaSy...)';
            }
        }
    } catch (e) {
        console.warn('Failed to load AI config:', e);
    }
}

function toggleApiKeyVisibility() {
    const input = document.getElementById('adminGeminiApiKeyInput');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function saveAdminAiConfig() {
    const input = document.getElementById('adminGeminiApiKeyInput');
    const alertBox = document.getElementById('adminAiFeedbackAlert');
    const saveBtn = document.getElementById('btnSaveAiKey');
    if (!input || !input.value.trim()) {
        showToast('Please enter a Google Gemini API key to test and activate.', 'warning');
        return;
    }

    const key = input.value.trim();
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ Testing Gemini Connection...';
    if (alertBox) alertBox.style.display = 'none';

    try {
        const res = await fetch('/api/admin/ai-config', {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ apiKey: key })
        });
        const data = await res.json();

        if (data.success) {
            showToast('✅ Google Gemini API key verified and activated!', 'success');
            if (alertBox) {
                alertBox.style.display = 'block';
                alertBox.style.background = '';
                alertBox.style.border = '';
                alertBox.style.color = '';
                if (data.warning) {
                    alertBox.className = 'ai-feedback-alert ai-feedback-warning';
                    alertBox.innerHTML = `<strong>⚠️ Verification Succeeded with Hybrid Fallback:</strong> ${escapeHtml(data.warning)}`;
                } else {
                    alertBox.className = 'ai-feedback-alert ai-feedback-success';
                    alertBox.innerHTML = `<strong>✅ Verification Succeeded:</strong> ${escapeHtml(data.message || 'Cloud connection confirmed!')} All future medical report uploads will utilize real-time clinical AI inference with automatic offline fallback.`;
                }
            }
            input.value = '';
            await loadAdminAiConfig();
        } else {
            showToast(`❌ ${data.message || 'Verification failed'}`, 'error');
            if (alertBox) {
                alertBox.style.display = 'block';
                alertBox.style.background = '';
                alertBox.style.border = '';
                alertBox.style.color = '';
                alertBox.className = 'ai-feedback-alert ai-feedback-error';
                alertBox.innerHTML = `<strong>❌ Verification Failed:</strong> ${escapeHtml(data.message || 'Invalid key or API connectivity error.')}`;
            }
        }
    } catch (e) {
        showToast(`❌ Connection error: ${e.message}`, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '⚡ Test & Activate Gemini AI';
    }
}

async function resetAdminAiConfig() {
    if (!confirm('Revert Consortium AI Gateway to Local Clinical NLP Engine (Offline Fallback)?')) return;

    const alertBox = document.getElementById('adminAiFeedbackAlert');
    const input = document.getElementById('adminGeminiApiKeyInput');

    try {
        const res = await fetch('/api/admin/ai-config', {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
            showToast('🔄 AI Gateway reverted to Offline Clinical NLP Engine', 'info');
            if (input) input.value = '';
            if (alertBox) {
                alertBox.style.display = 'block';
                alertBox.style.background = '';
                alertBox.style.border = '';
                alertBox.style.color = '';
                alertBox.className = 'ai-feedback-alert ai-feedback-info';
                alertBox.innerHTML = `<strong>🔄 Reverted to Offline Mode:</strong> System is operating via the built-in Local Clinical NLP Engine with zero external dependencies.`;
            }
            await loadAdminAiConfig();
        }
    } catch (e) {
        showToast(`Reset failed: ${e.message}`, 'error');
    }
}


function renderAdminUsersTable(users) {
    const staffTbody = document.getElementById('adminStaffTableBody');
    const patientsTbody = document.getElementById('adminPatientsTableBody');

    const staffUsers = users.filter(u => u.role !== 'Patient');
    const patientUsers = users.filter(u => u.role === 'Patient');

    if (staffTbody) {
        staffTbody.innerHTML = '';
        staffUsers.forEach(u => {
            const tr = document.createElement('tr');
            const avatar = u.role === 'Doctor' ? '👨‍⚕️' : u.role === 'Lab Staff' ? '🔬' : u.role === 'Receptionist' ? '🗂️' : '🛡️';
            const tagClass = u.role === 'Doctor' ? 'tag-doctor' : u.role === 'Lab Staff' ? 'tag-lab' : 'tag-admin';
            const deptInfo = u.department || u.laboratory || u.institution || 'SIT Students Hospital';
            const licenseOrNode = u.license || u.nodeId || 'NODE-HOSP-01';

            tr.innerHTML = `
                <td>
                    <strong>${avatar} ${escapeHtml(u.name)}</strong>
                    <div style="font-size: 0.74rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(u.id)}</div>
                </td>
                <td><span class="role-card-tag ${tagClass}">${escapeHtml(u.role)}</span></td>
                <td style="font-family: var(--font-mono); font-size: 0.8rem;">${escapeHtml(u.email)}</td>
                <td style="font-size: 0.82rem;">${escapeHtml(deptInfo)}</td>
                <td style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(licenseOrNode)}</td>
                <td>
                    ${u.role !== 'Admin'
                        ? `<button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; color: var(--accent-danger); border-color: rgba(239, 68, 68, 0.4);" onclick="deleteAdminUser('${escapeHtml(u.id)}')">🗑️ Remove Staff</button>`
                        : `<span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700;">Protected Admin</span>`
                    }
                </td>
            `;
            staffTbody.appendChild(tr);
        });
    }

    if (patientsTbody) {
        patientsTbody.innerHTML = '';
        patientUsers.forEach(p => {
            const tr = document.createElement('tr');
            const billNo = p.billNumber || p.receptionId || p.patientId || 'BILL-2026-1001';
            tr.innerHTML = `
                <td>
                    <strong>🧑 ${escapeHtml(p.name)}</strong>
                    <div style="font-size: 0.75rem; color: var(--accent-cyan); font-family: var(--font-mono); font-weight: 700;">UHID: ${escapeHtml(p.patientId || p.id)}</div>
                </td>
                <td>
                    <span class="report-id-badge">${escapeHtml(billNo)}</span>
                </td>
                <td style="font-size: 0.82rem;">
                    <strong>${escapeHtml(p.age || '-')} Y</strong> / ${escapeHtml(p.gender || '-')} • Blood: <strong>${escapeHtml(p.bloodGroup || 'O+')}</strong>
                </td>
                <td style="font-size: 0.82rem;">${escapeHtml(p.assignedDoctor || 'Dr. Sarah Rao (General Medicine)')}</td>
                <td style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(p.contact || p.email || '-')}</td>
                <td>
                    <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                        <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="adminOpenPatientFile('${escapeHtml(p.id)}')">📂 View File</button>
                        <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; color: var(--accent-danger); border-color: rgba(239, 68, 68, 0.4);" onclick="deleteAdminUser('${escapeHtml(p.id)}')">🗑️ Remove Patient</button>
                    </div>
                </td>
            `;
            patientsTbody.appendChild(tr);
        });
    }
}

function adminOpenPatientFile(patientId) {
    const tabRecords = document.getElementById('tabNavRecords');
    if (tabRecords) tabRecords.click();
    selectDoctorPatient(patientId);
}
window.adminOpenPatientFile = adminOpenPatientFile;

function populatePatientDropdowns(users) {
    const patients = users.filter(u => u.role === 'Patient');
    allPatientsCache = patients;

    const uploadSelect = document.getElementById('uploadPatient');
    const timelineSelect = document.getElementById('timelinePatientSelect');
    const rxPatientSelect = document.getElementById('rxPatientSelect');
    const docQuickDropdown = document.getElementById('doctorQuickPatientDropdown');
    const billChipsBox = document.getElementById('portalBillChipsBox');

    if (uploadSelect) {
        uploadSelect.innerHTML = patients.map(p => 
            `<option value="${p.id}">${escapeHtml(p.name)} (${p.patientId || p.id}${p.billNumber ? ' | ' + p.billNumber : ''}, Age: ${p.age || 'N/A'}, ${p.gender || 'N/A'})</option>`
        ).join('');
    }

    if (timelineSelect) {
        timelineSelect.innerHTML = patients.map(p => 
            `<option value="${p.id}">${escapeHtml(p.name)} (${p.patientId || p.id}${p.billNumber ? ' | ' + p.billNumber : ''})</option>`
        ).join('');
        if (selectedDoctorPatientId) timelineSelect.value = selectedDoctorPatientId;
    }

    if (rxPatientSelect) {
        rxPatientSelect.innerHTML = patients.map(p => 
            `<option value="${p.id}">${escapeHtml(p.name)} (${p.patientId || p.id}${p.billNumber ? ' | ' + p.billNumber : ''})</option>`
        ).join('');
        if (selectedDoctorPatientId) rxPatientSelect.value = selectedDoctorPatientId;
    }

    if (docQuickDropdown) {
        docQuickDropdown.innerHTML = `<option value="">-- Choose Patient from Dropdown (${patients.length} Registered) --</option>` +
            patients.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.patientId || p.id} | ${p.billNumber || ''})</option>`).join('');
        if (selectedDoctorPatientId) docQuickDropdown.value = selectedDoctorPatientId;
    }

    if (billChipsBox) {
        billChipsBox.innerHTML = patients.map(p => {
            const bNo = p.billNumber || p.patientId;
            return `<button type="button" class="btn btn-secondary" style="font-size: 0.74rem; padding: 4px 10px;" onclick="loginWithBillNumber('${escapeHtml(bNo)}')">${escapeHtml(bNo)} (${escapeHtml(p.name)})</button>`;
        }).join('');
    }

    updateDoctorPatientGateUI();
}

async function deleteAdminUser(userId) {
    if (!confirm('Are you sure you want to remove this identity from the healthcare consortium?')) return;

    try {
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
            alert('✓ Identity successfully removed.');
            loadAdminUsers();
        } else {
            alert('Removal failed: ' + data.message);
        }
    } catch (e) {
        alert('Error removing user: ' + e.message);
    }
}

// ==========================================================================
// 11. FORM LISTENERS INITIALIZATION
// ==========================================================================
function initFormListeners() {
    // 1. Credentials Login Form
    const credsForm = document.getElementById('credentialLoginForm');
    if (credsForm) {
        credsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmailInput').value;
            const password = document.getElementById('loginPasswordInput').value;
            loginWithCredentials(email, password);
        });
    }

    // 1b. Patient Portal Login Form (Bill Number + 8-Char Access Code or Password)
    const billForm = document.getElementById('patientBillPortalForm');
    if (billForm) {
        billForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const billNo = document.getElementById('portalBillNumberInput').value;
            const secret = document.getElementById('portalBillSecretInput').value;
            const useCode = document.getElementById('portalUseAccessCodeCheckbox')?.checked !== false;
            loginWithBillAndSecret(billNo, secret, useCode);
        });
    }

    // 1c. Mandatory / Voluntary Change Password Form
    const changePwForm = document.getElementById('changePasswordForm');
    if (changePwForm) {
        changePwForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('currentPasswordInput')?.value || '';
            const newPassword = document.getElementById('newPersonalPasswordInput').value;
            const confirmPassword = document.getElementById('confirmPersonalPasswordInput').value;

            if (newPassword !== confirmPassword) {
                alert('New password and confirmation do not match.');
                return;
            }
            if (newPassword.length < 10) {
                alert('Password must be at least 10 characters long.');
                return;
            }

            try {
                const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ currentPassword, newPassword })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    alert(data.message || 'Password update failed.');
                    return;
                }
                closeModal('changePasswordModal');
                changePwForm.reset();
                showToast('✓ Personal password saved! Session refreshed.', 'success');
                applySession(data.token, data.user);
            } catch (err) {
                alert('Error changing password: ' + err.message);
            }
        });
    }

    // 2. Doctor Edit Report Form
    const editForm = document.getElementById('editReportForm');
    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reportId = document.getElementById('editReportIdInput').value;
            const notes = document.getElementById('editReportNotes').value;
            const diagnosisStatus = document.getElementById('editDiagnosisStatus').value;
            const prescription = document.getElementById('editReportPrescription').value;
            const followUpDate = document.getElementById('editReportFollowUp').value;

            try {
                const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ notes, diagnosisStatus, prescription, followUpDate })
                });

                const data = await res.json();
                if (data.success) {
                    alert('✓ Clinical notes & diagnosis successfully updated by Attending Physician!');
                    closeModal('editReportModal');
                    loadReports();
                    loadTimeline();
                    loadAuditLogs();
                } else {
                    alert('Update failed: ' + data.message);
                }
            } catch (err) {
                alert('Error updating report: ' + err.message);
            }
        });
    }

    // 3. Admin Create User Form
    const adminUserForm = document.getElementById('adminCreateUserForm');
    if (adminUserForm) {
        adminUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const role = document.getElementById('newRoleSelect').value;
            const name = document.getElementById('newNameInput').value;
            const email = document.getElementById('newEmailInput').value;
            const password = document.getElementById('newPasswordInput').value;

            const payload = { role, name, email, password };

            if (role === 'Doctor') {
                payload.department = document.getElementById('newDoctorDept').value;
                payload.hospital = document.getElementById('newDoctorHospital').value;
                payload.doctorLicense = document.getElementById('newDoctorLicense').value;
            } else if (role === 'Patient') {
                payload.patientId = document.getElementById('newPatientId').value;
                payload.age = document.getElementById('newPatientAge').value;
                payload.gender = document.getElementById('newPatientGender').value;
                payload.bloodGroup = document.getElementById('newPatientBlood').value;
            } else if (role === 'Lab Staff') {
                payload.designation = document.getElementById('newLabDesignation').value;
                payload.laboratory = document.getElementById('newLabName').value;
            }

            try {
                const res = await fetch('/api/admin/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (data.success) {
                    const credMsg = data.oneTimeAccessCode
                        ? `\nOne-Time Patient Access Code (72h): ${data.oneTimeAccessCode}\nTemporary Password: ${data.temporaryPassword}`
                        : `\nOne-Time Temporary Password: ${data.temporaryPassword}`;
                    alert(`✓ SUCCESS: ${role} account created for ${name} (${email})!${credMsg}\n\nShare this credential securely — password reset is required on first login.`);
                    adminUserForm.reset();
                    updateRoleSpecificFields();
                    loadAdminUsers();
                } else {
                    alert('Registration failed: ' + data.message);
                }
            } catch (err) {
                alert('Error creating user: ' + err.message);
            }
        });
    }

    // 4. Share Form Listener
    const shareForm = document.getElementById('shareLinkForm');
    if (shareForm) {
        shareForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reportId = document.getElementById('shareReportId').value;
            const durationMinutes = document.getElementById('shareDuration').value;
            const recipientDoctor = document.getElementById('shareDoctor').value;

            try {
                const res = await fetch('/api/share/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                    body: JSON.stringify({ reportId, durationMinutes, recipientDoctor })
                });

                const data = await res.json();
                if (data.success) {
                    currentShareUrl = data.shareUrl;
                    document.getElementById('generatedShareUrl').value = data.shareUrl;
                    document.getElementById('openShareUrlBtn').href = data.shareUrl;
                    document.getElementById('shareResultBox').style.display = 'block';
                    loadActiveShareLinks();
                } else {
                    alert('Share failed: ' + data.message);
                }
            } catch (e) {
                alert('Error generating share link: ' + e.message);
            }
        });
    }
}

// ==========================================================================
// 12. BLOCKCHAIN EXPLORER & TAMPER SIMULATOR
// ==========================================================================
async function loadBlockchain() {
    const stream = document.getElementById('blockchainStream');
    if (!stream) return;
    try {
        const res = await fetch('/api/blockchain/ledger', { headers: getAuthHeaders() });
        const data = await res.json();

        stream.innerHTML = '';
        if (!data.success || !data.chain) return;
        if (data.ethereum) updateEthereumStatusBanner(data.ethereum);

        data.chain.forEach(block => {
            const card = document.createElement('div');
            const isGenesis = (block.index === 0);
            const isTampered = (block.data && block.data.tampered);
            const onChain = block.data && block.data.onChain;
            const onChainHtml = onChain && onChain.txHash
                ? `<div class="hash-row"><span class="hash-label">Ethereum TX:</span><a href="${escapeHtml(onChain.explorerTxUrl || '#')}" target="_blank" rel="noreferrer" style="color: var(--accent-success); font-weight: 700;">${escapeHtml(onChain.txHash)} (Block #${escapeHtml(String(onChain.ethBlockNumber || ''))}) ↗</a></div>`
                : '';

            card.className = `block-card ${isGenesis ? 'genesis' : ''} ${isTampered ? 'tampered' : ''}`;

            card.innerHTML = `
                <div class="block-header">
                    <div>
                        <span class="block-index-tag">${isGenesis ? '⭐ GENESIS BLOCK #0' : `BLOCK #${block.index}`}</span>
                        <strong style="margin-left: 10px; font-size: 0.95rem;">
                            ${isGenesis ? 'Hospital Hash-Chain Genesis' : escapeHtml(block.data.reportType || 'Medical Report Block')}
                        </strong>
                    </div>
                    <span style="font-size: 0.78rem; color: var(--text-muted);">
                        ⏱️ ${new Date(block.timestamp).toLocaleString()}
                    </span>
                </div>

                <div class="hash-row">
                    <span class="hash-label">Block Hash:</span>
                    <span class="hash-value">${escapeHtml(block.hash)}</span>
                </div>
                <div class="hash-row">
                    <span class="hash-label">Prev Hash:</span>
                    <span class="block-prev-hash">${escapeHtml(block.previousHash)}</span>
                </div>
                ${onChainHtml}

                <div class="block-payload-box">
                    <strong>Block Payload Data:</strong>
                    <pre class="block-payload-pre">${escapeHtml(JSON.stringify(block.data, null, 2))}</pre>
                </div>
            `;

            stream.appendChild(card);
        });

    } catch (e) {
        console.error('Blockchain load error:', e);
    }
}

async function verifyChainIntegrity() {
    try {
        const res = await fetch('/api/blockchain/verify', { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.isValid) {
            alert('✓ BLOCKCHAIN INTEGRITY VERIFIED: All block hashes and previousHash cryptographic links are 100% valid!');
        } else {
            alert(`⚠️ TAMPERING DETECTED ON LEDGER!\n${data.details.error}`);
        }
        loadStats();
        loadBlockchain();
    } catch (e) {
        alert('Verification request failed: ' + e.message);
    }
}

async function triggerTamperSimulation() {
    if (!confirm('Simulate malicious block modification? This will alter Block #1 hash to demonstrate how blockchain catches tampering live for the panel.')) return;

    try {
        const res = await fetch('/api/blockchain/tamper-demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ blockIndex: 1, maliciousHash: '0000000000malicious_hacker_hash_tamper_attempt' })
        });
        await res.json();
        alert(`⚠️ TAMPER INJECTED: Block #1 has been modified.\n\nNow running chain verification to see detection:`);
        verifyChainIntegrity();
    } catch (e) {
        alert('Tamper demo failed: ' + e.message);
    }
}

async function restoreChain() {
    try {
        const res = await fetch('/api/blockchain/restore', { method: 'POST', headers: getAuthHeaders() });
        const data = await res.json();
        alert(data.message);
        loadStats();
        loadBlockchain();
    } catch (e) {
        alert('Restore failed: ' + e.message);
    }
}

// ==========================================================================
// 13. AUDIT LOGS
// ==========================================================================
async function loadAuditLogs() {
    const tbody = document.getElementById('auditLogsBody');
    if (!tbody) return;
    try {
        const res = await fetch('/api/blockchain/audit-logs', { headers: getAuthHeaders() });
        const data = await res.json();
        tbody.innerHTML = '';

        if (!data.success || !data.logs || data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No audit events recorded.</td></tr>';
            return;
        }

        data.logs.forEach(l => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-family: var(--font-mono); font-size: 0.78rem;">${new Date(l.timestamp).toLocaleTimeString()}</td>
                <td><strong style="color: var(--accent-cyan); font-size: 0.8rem;">${escapeHtml(l.action)}</strong></td>
                <td style="font-size: 0.82rem;">${escapeHtml(l.actor)}</td>
                <td style="font-size: 0.82rem;">${escapeHtml(l.details)}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error('Audit logs error:', e);
    }
}

// ==========================================================================
// TOAST NOTIFICATION SYSTEM
// ==========================================================================
function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 99999; display: flex; flex-direction: column; gap: 10px; max-width: 440px; pointer-events: none;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const isError = type === 'error';
    const isSuccess = type === 'success';
    const bg = isError ? 'rgba(239, 68, 68, 0.95)' : isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.95)';
    const border = isError ? '#f87171' : isSuccess ? '#34d399' : 'var(--accent-cyan)';

    toast.style.cssText = `background: ${bg}; color: #ffffff; padding: 12px 18px; border-radius: 8px; border: 1px solid ${border}; box-shadow: 0 10px 25px rgba(0,0,0,0.45); font-size: 0.88rem; font-weight: 500; display: flex; align-items: center; gap: 10px; pointer-events: auto; backdrop-filter: blur(8px); transition: all 0.3s ease;`;
    toast.innerHTML = `<span style="font-size: 1.1rem;">${isError ? '⚠️' : isSuccess ? '✅' : 'ℹ️'}</span><span style="flex: 1;">${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 350);
    }, 4500);
}

// Modal view switcher: summary vs live PDF preview
function switchModalView(mode) {
    const summaryView = document.getElementById('modalReportSummaryView');
    const pdfView = document.getElementById('modalReportPdfView');
    const sumBtn = document.getElementById('modalTabSummaryBtn');
    const pdfBtn = document.getElementById('modalTabPdfBtn');

    if (mode === 'pdf') {
        if (summaryView) summaryView.style.display = 'none';
        if (pdfView) pdfView.style.display = 'block';
        if (sumBtn) { sumBtn.classList.remove('btn-primary'); sumBtn.classList.add('btn-secondary'); }
        if (pdfBtn) { pdfBtn.classList.remove('btn-secondary'); pdfBtn.classList.add('btn-primary'); }
    } else {
        if (summaryView) summaryView.style.display = 'block';
        if (pdfView) pdfView.style.display = 'none';
        if (sumBtn) { sumBtn.classList.remove('btn-secondary'); sumBtn.classList.add('btn-primary'); }
        if (pdfBtn) { pdfBtn.classList.remove('btn-primary'); pdfBtn.classList.add('btn-secondary'); }
    }
}

// ==========================================================================
// 14. MODAL POPUPS & HANDLERS
// ==========================================================================
async function openReportModal(reportId) {
    const modal = document.getElementById('viewReportModal');
    const badge = document.getElementById('modalReportBadge');
    const title = document.getElementById('modalReportTitle');
    const sub = document.getElementById('modalReportSubtitle');
    const content = document.getElementById('modalReportContent');
    const hash = document.getElementById('modalReportHash');
    const downloadBtn = document.getElementById('modalDownloadBtn');
    const openPdfTabBtn = document.getElementById('modalOpenPdfTabBtn');
    const editBtn = document.getElementById('modalDoctorEditBtn');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    const remarksSection = document.getElementById('modalDoctorRemarksSection');
    const remarksContent = document.getElementById('modalDoctorRemarksContent');
    const pdfFrame = document.getElementById('modalPdfFrame');

    badge.textContent = reportId;
    title.textContent = 'Decrypting report from AES storage...';
    sub.textContent = 'Verifying cryptographic integrity against permissioned blockchain ledger...';
    content.innerHTML = '<div style="color: var(--accent-cyan); padding: 1.25rem 0; text-align: center;">⏳ Decrypting record & recalculating SHA-256 fingerprint...</div>';
    remarksSection.style.display = 'none';
    switchModalView('summary');

    // Doctor edit button inside modal
    if (currentUser && (currentUser.role === 'Doctor' || currentUser.role === 'Admin')) {
        editBtn.style.display = 'inline-block';
        editBtn.onclick = () => {
            closeModal('viewReportModal');
            openEditReportModal(reportId);
        };
    } else {
        editBtn.style.display = 'none';
    }

    // Soft-delete button inside modal (Admin ONLY — F-04)
    const canDelete = currentUser && currentUser.role === 'Admin';
    if (deleteBtn) {
        if (canDelete) {
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.onclick = () => {
                confirmDeleteReport(reportId, title.textContent, true);
            };
        } else {
            deleteBtn.style.display = 'none';
        }
    }

    modal.classList.add('active');

    try {
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success && data.report) {
            const r = data.report;
            title.textContent = r.title;
            sub.textContent = `Patient: ${r.patientName} (${r.patientPseudonym}) • Date: ${r.testDate} • Category: ${r.reportType} • Ledger Block #${r.blockIndex || 1}`;
            hash.textContent = `SHA-256 Fingerprint: ${r.reportHash}`;

            // Build rich diagnostic parameters table
            let bodyHtml = '';
            if (r.testParameters && Array.isArray(r.testParameters) && r.testParameters.length > 0) {
                bodyHtml += `
                    <div class="lit-table-wrapper" style="margin-bottom: 1rem;">
                        <table class="lit-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                            <thead>
                                <tr>
                                    <th>Investigation / Parameter</th>
                                    <th>Observed Value</th>
                                    <th>Reference Range</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                r.testParameters.forEach((param) => {
                    const statusColor = param.isAbnormal ? 'var(--accent-danger)' : 'var(--accent-success)';
                    const statusBadgeBg = param.isAbnormal ? 'rgba(239, 68, 68, 0.14)' : 'rgba(16, 185, 129, 0.14)';
                    bodyHtml += `
                        <tr>
                            <td style="padding: 10px 14px; font-weight: 600;">${escapeHtml(param.parameter)}</td>
                            <td style="padding: 10px 14px; font-weight: 700; color: ${statusColor};">${escapeHtml(param.value)}</td>
                            <td style="padding: 10px 14px; color: var(--text-muted); font-size: 0.82rem;">${escapeHtml(param.ref || 'Normal')}</td>
                            <td style="padding: 10px 14px;">
                                <span style="background: ${statusBadgeBg}; color: ${statusColor}; padding: 3px 10px; border-radius: 99px; font-size: 0.74rem; font-weight: 800;">
                                    ${escapeHtml(param.status)}
                                </span>
                            </td>
                        </tr>
                    `;
                });
                bodyHtml += `</tbody></table></div>`;
            }

            if (r.aiHighlights && (r.aiHighlights.keyFindings || r.aiHighlights.diagnosticImpression)) {
                const findingsList = (r.aiHighlights.keyFindings || []).map(f => `<li class="report-ai-bullet">${escapeHtml(f)}</li>`).join('');
                const abnormalList = (r.aiHighlights.abnormalFlags || []).filter(a => !a.toLowerCase().includes('no critical')).map(a => `<li>${escapeHtml(a)}</li>`).join('');
                bodyHtml += `
                    <div class="report-ai-box" style="padding: 12px 16px; margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <strong class="report-ai-title" style="font-size: 0.88rem; display: flex; align-items: center; gap: 6px;">
                                🤖 AI Clinical Key Findings &amp; Highlights
                            </strong>
                            <span style="font-size: 0.72rem; background: rgba(13, 148, 136, 0.15); color: var(--accent-teal); padding: 2px 8px; border-radius: 12px; font-weight: 700;">
                                ${escapeHtml(r.aiHighlights.aiEngine || 'Clinical Rule Engine')}
                            </span>
                        </div>
                        ${findingsList ? `<ul style="margin: 0 0 8px 16px; padding: 0; font-size: 0.82rem; line-height: 1.4;">${findingsList}</ul>` : ''}
                        ${abnormalList ? `
                            <div style="margin-top: 6px; padding: 6px 10px; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--accent-danger); border-radius: 4px; color: var(--accent-danger);">
                                <strong style="font-size: 0.75rem;">Flagged Abnormalities:</strong>
                                <ul style="margin: 2px 0 0 14px; padding: 0; font-size: 0.78rem;">${abnormalList}</ul>
                            </div>
                        ` : ''}
                        ${r.aiHighlights.diagnosticImpression ? `
                            <div style="margin-top: 6px; font-size: 0.8rem; color: var(--text-secondary);">
                                <strong style="color: var(--text-primary);">Summary:</strong> ${escapeHtml(r.aiHighlights.diagnosticImpression)}
                            </div>
                        ` : ''}
                    </div>
                `;
            }

            if (r.clinicalImpression || r.notes) {
                bodyHtml += `
                    <div class="theme-subbox" style="border-left: 3px solid var(--accent-cyan); padding: 10px 14px; border-radius: 4px; margin-bottom: 12px;">
                        <strong style="color: var(--accent-cyan); font-size: 0.82rem; text-transform: uppercase;">Clinical Impression:</strong>
                        <p style="margin: 4px 0 0 0; color: var(--text-primary); font-size: 0.86rem; line-height: 1.5;">${escapeHtml(r.clinicalImpression || r.notes)}</p>
                    </div>
                `;
            }

            if (r.sampleContent && (!r.testParameters || r.testParameters.length === 0)) {
                bodyHtml += `<pre class="report-raw-pre">${escapeHtml(r.sampleContent)}</pre>`;
            }

            content.innerHTML = bodyHtml || '<div style="color: var(--text-muted);">Decrypted diagnostic investigation archived on blockchain.</div>';

            // Fetch authenticated PDF via Authorization header -> Blob URL (NEVER ?token= in URL!)
            if (currentModalPdfBlobUrl) {
                URL.revokeObjectURL(currentModalPdfBlobUrl);
                currentModalPdfBlobUrl = null;
            }
            if (pdfFrame) pdfFrame.src = 'about:blank';
            if (openPdfTabBtn) {
                openPdfTabBtn.href = '#';
                openPdfTabBtn.onclick = async (e) => {
                    e.preventDefault();
                    if (currentModalPdfBlobUrl) {
                        window.open(currentModalPdfBlobUrl, '_blank', 'noopener,noreferrer');
                    } else {
                        await loadModalPdfPreview(r.reportId, pdfFrame);
                        if (currentModalPdfBlobUrl) window.open(currentModalPdfBlobUrl, '_blank', 'noopener,noreferrer');
                    }
                };
            }
            loadModalPdfPreview(r.reportId, pdfFrame);

            // Wire up secure download button
            const safeDownloadName = r.fileName || `${r.reportId}.pdf`;
            downloadBtn.onclick = (e) => {
                e.preventDefault();
                downloadReportFile(r.reportId, safeDownloadName);
            };

            if (r.doctorRemarks || (Array.isArray(r.sharedDoctorNotes) && r.sharedDoctorNotes.length > 0)) {
                remarksSection.style.display = 'block';
                const notesList = Array.isArray(r.sharedDoctorNotes) && r.sharedDoctorNotes.length > 0
                    ? r.sharedDoctorNotes
                    : [{
                        doctorName: r.doctorRemarks ? r.doctorRemarks.doctorName : 'Dr. Sarah Rao, MD',
                        department: r.doctorRemarks ? r.doctorRemarks.department : 'General Medicine',
                        status: r.doctorRemarks ? r.doctorRemarks.status : 'Verified',
                        notes: r.notes || 'Reviewed clinical findings.',
                        prescription: r.prescription || '',
                        followUpDate: r.followUpDate || '',
                        updatedAt: r.doctorRemarks ? r.doctorRemarks.updatedAt : r.testDate
                    }];

                remarksContent.innerHTML = `
                    <div style="margin-bottom: 0.65rem; font-size: 0.8rem; font-weight: 700; color: var(--accent-teal);">
                        🏥 Multi-Doctor Shared Consultation Thread (${notesList.length} SIT Hospital Doctor Review${notesList.length > 1 ? 's' : ''}):
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 0.65rem;">
                        ${notesList.map((dn, idx) => `
                            <div class="card" style="padding: 0.75rem 0.9rem; border-radius: 6px; border-left: 4px solid var(--accent-teal);">
                                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.35rem;">
                                    <strong style="color: var(--text-primary); font-size: 0.88rem;">👨‍⚕️ #${idx + 1} ${escapeHtml(dn.doctorName || 'Hospital Doctor')} (${escapeHtml(dn.department || 'SIT Hospital')})</strong>
                                    <span style="font-size: 0.74rem; background: rgba(16, 185, 129, 0.14); color: var(--accent-success); padding: 2px 8px; border-radius: 4px; font-weight: 700;">
                                        ${escapeHtml(dn.status || 'Reviewed')} • ${escapeHtml((dn.updatedAt || '').slice(0, 10))}
                                    </span>
                                </div>
                                <div style="font-size: 0.84rem; color: var(--text-secondary); margin-bottom: 0.25rem;">
                                    <strong style="color: var(--text-primary);">Clinical Note:</strong> ${escapeHtml(dn.notes || 'Reviewed')}
                                </div>
                                ${dn.prescription ? `<div style="font-size: 0.84rem; color: var(--accent-teal);"><strong>Rx / Medicines Prescribed:</strong> ${escapeHtml(dn.prescription)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        }
    } catch (e) {
        content.innerHTML = `<div style="color: #f87171;">Error decrypting report: ${escapeHtml(e.message)}</div>`;
    }
}

async function loadModalPdfPreview(reportId, pdfFrame) {
    try {
        const pdfRes = await fetch(`/api/reports/${encodeURIComponent(reportId)}/download?inline=true`, {
            headers: getAuthHeaders()
        });
        if (!pdfRes.ok) return;
        const blob = await pdfRes.blob();
        currentModalPdfBlobUrl = URL.createObjectURL(blob);
        if (pdfFrame) pdfFrame.src = currentModalPdfBlobUrl;
    } catch (_) {}
}

/**
 * Downloads a decrypted medical report with live blockchain verification (Bearer header only)
 */
async function downloadReportFile(reportId, preferredFileName) {
    try {
        showToast('🔓 Decrypting report with AES-256-GCM and validating SHA-256...', 'info');
        const url = `/api/reports/${encodeURIComponent(reportId)}/download`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) {
            let errMsg = 'Failed to download report.';
            try {
                const errData = await res.json();
                errMsg = errData.message || errMsg;
            } catch (ignored) {}
            showToast(`❌ ${errMsg}`, 'error');
            return;
        }

        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = blobUrl;
        a.download = preferredFileName || `${reportId}.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            document.body.removeChild(a);
        }, 150);
        showToast('✅ Authentic PDF decrypted & downloaded successfully!', 'success');
    } catch (err) {
        showToast(`❌ Download error: ${err.message}`, 'error');
    }
}

/**
 * Admin-only Soft-Delete with documented reason (retains encrypted file & ledger anchor)
 */
async function confirmDeleteReport(reportId, reportTitle, closeCurrentModal = false) {
    const titleText = reportTitle || reportId;
    const reason = prompt(`Soft-delete report "${titleText}" (${reportId}) from active views?\n\nEncrypted archive & blockchain anchor are retained for audit.\nEnter mandatory administrative reason (min 3 chars):`);
    if (reason === null) return;
    if (reason.trim().length < 3) {
        alert('A documented reason (at least 3 characters) is required.');
        return;
    }

    try {
        showToast(`🗑️ Soft-deleting report ${reportId}...`, 'info');
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ reason: reason.trim() })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.message || 'Failed to soft-delete report');
        }

        showToast(`✓ ${data.message || 'Report soft-deleted'}`, 'success');
        if (closeCurrentModal) {
            closeModal('viewReportModal');
        }
        await loadReports();
        await loadTimeline();
        await loadStats();
        await loadBlockchain();
    } catch (err) {
        alert('Soft-delete failed: ' + err.message);
        showToast('❌ Soft-delete failed: ' + err.message, 'error');
    }
}

let currentActiveQrReportId = null;

async function openQrModal(reportId) {
    currentActiveQrReportId = reportId;
    const modal = document.getElementById('qrModal');
    const img = document.getElementById('qrModalImg');
    const badge = document.getElementById('qrReportId');
    const titleDisplay = document.getElementById('qrReportTitleDisplay');
    const directLink = document.getElementById('qrDirectVerifyLink');
    const hashDisplay = document.getElementById('qrHashDisplay');
    const blockDisplay = document.getElementById('qrBlockDisplay');
    const liveResultBox = document.getElementById('qrLiveResultBox');
    const verifyNowBtn = document.getElementById('qrVerifyNowBtn');

    if (badge) badge.textContent = reportId;
    if (img) img.src = '';
    if (hashDisplay) hashDisplay.textContent = 'Loading cryptographic fingerprint from blockchain...';
    if (liveResultBox) {
        liveResultBox.style.display = 'none';
        liveResultBox.innerHTML = '';
    }
    if (verifyNowBtn) {
        verifyNowBtn.disabled = false;
        verifyNowBtn.innerHTML = '⚡ Verify Hash Against Ledger';
    }

    modal.classList.add('active');

    try {
        const res = await fetch(`/api/qr/${encodeURIComponent(reportId)}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.success) {
            const qrUrl = data.qrCodeDataUrl || data.qrDataUrl;
            if (img) {
                img.src = qrUrl;
            }
            if (titleDisplay && data.title) {
                titleDisplay.textContent = data.title;
            }
            if (hashDisplay) {
                hashDisplay.textContent = data.anchoredHash || data.reportHash || 'Fingerprint anchored on ledger';
            }
            if (blockDisplay) {
                blockDisplay.textContent = `Anchored Block #${data.blockIndex || 1}`;
            }

            currentVerificationUrl = data.scanUrl || data.verificationUrl;
            if (directLink) {
                directLink.href = data.verificationUrl;
            }
        }
    } catch (e) {
        alert('QR code load failed: ' + e.message);
    }
}

async function runLiveModalVerification() {
    if (!currentActiveQrReportId) return;
    const btn = document.getElementById('qrVerifyNowBtn');
    const liveResultBox = document.getElementById('qrLiveResultBox');
    if (!btn || !liveResultBox) return;

    btn.disabled = true;
    btn.innerHTML = '⏳ Computing Live SHA-256...';

    try {
        const res = await fetch(`/api/verify/${encodeURIComponent(currentActiveQrReportId)}`, { headers: getAuthHeaders() });
        const data = await res.json();

        liveResultBox.style.display = 'block';
        liveResultBox.style.background = '';
        liveResultBox.style.border = '';

        if (data.isAuthentic || data.status === 'MATCH') {
            liveResultBox.className = 'verify-live-pass';
            liveResultBox.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="font-size: 1.3rem;">✅</span>
                    <strong class="verify-live-title">VERIFICATION PASSED: AUTHENTIC ORIGINAL</strong>
                </div>
                <div class="verify-live-meta">
                    <div><strong>Live Computed File Hash:</strong> <span class="verify-live-hash-live">${escapeHtml(data.liveComputedHash || 'Verified server-side')}</span></div>
                    <div><strong>Anchored Blockchain Hash:</strong> <span class="verify-live-hash-anchored">${escapeHtml(data.anchoredBlockchainHash || 'Verified server-side')}</span></div>
                    <div style="margin-top: 6px; color: var(--text-muted); font-family: var(--font-sans);">
                        ✓ Validated against Block #${data.blockchainDetails ? data.blockchainDetails.blockIndex : 1} (${escapeHtml(data.blockchainDetails ? data.blockchainDetails.institutionNode : 'Consortium Node')}). Zero tampering detected.
                    </div>
                </div>
            `;
        } else {
            liveResultBox.className = 'verify-live-fail';
            liveResultBox.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="font-size: 1.3rem;">❌</span>
                    <strong class="verify-live-title">TAMPER ALERT: HASH MISMATCH</strong>
                </div>
                <div class="verify-live-fail-desc">
                    The live computed hash does not match the ledger block! Document may have been modified or corrupted.
                </div>
            `;
        }
    } catch (e) {
        liveResultBox.style.display = 'block';
        liveResultBox.className = 'verify-live-fail';
        liveResultBox.innerHTML = `<span class="verify-live-error">Verification check failed: ${escapeHtml(e.message)}</span>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '⚡ Re-verify Hash Against Ledger';
    }
}

function openShareModal(reportId, reportTitle) {
    const modal = document.getElementById('shareModal');
    document.getElementById('shareReportId').value = reportId;
    document.getElementById('shareReportTitle').value = `${reportId} - ${reportTitle}`;
    document.getElementById('shareResultBox').style.display = 'none';
    modal.classList.add('active');
    loadActiveShareLinks();
}

async function loadActiveShareLinks() {
    const box = document.getElementById('activeShareLinksContainer');
    if (!box) return;
    try {
        const res = await fetch('/api/share', { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.links) || data.links.length === 0) {
            box.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted);">No share links issued yet.</div>';
            return;
        }
        box.innerHTML = data.links.slice(0, 10).map(l => {
            const isRevoked = Boolean(l.revokedAt);
            const isExpired = new Date(l.expiresAt).getTime() <= Date.now();
            const statusText = isRevoked ? 'REVOKED' : isExpired ? 'EXPIRED' : 'ACTIVE';
            const statusColor = isRevoked ? '#ef4444' : isExpired ? '#94a3b8' : '#10b981';
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 6px 10px; border: 1px solid var(--border-subtle); border-radius: 6px; font-size: 0.78rem;">
                    <div>
                        <strong>${escapeHtml(l.reportId)}</strong> → ${escapeHtml(l.recipientDoctor || 'Specialist')}
                        <div style="font-size: 0.72rem; color: var(--text-muted);">Expires: ${new Date(l.expiresAt).toLocaleString()} • <strong style="color: ${statusColor};">${statusText}</strong></div>
                    </div>
                    ${(!isRevoked && !isExpired)
                        ? `<button type="button" class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.72rem; color: var(--accent-danger);" onclick="revokeIssuedShareLink('${escapeHtml(l.jti)}')">🚫 Revoke</button>`
                        : ''
                    }
                </div>
            `;
        }).join('');
    } catch (e) {
        box.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted);">Could not load share links.</div>';
    }
}

async function revokeIssuedShareLink(jti) {
    if (!confirm('Immediately revoke this share link? Any external viewer holding it will lose access instantly.')) return;
    try {
        const res = await fetch(`/api/share/${encodeURIComponent(jti)}/revoke`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
            showToast('🚫 Share link revoked immediately.', 'success');
            loadActiveShareLinks();
        } else {
            alert(data.message || 'Revocation failed.');
        }
    } catch (err) {
        alert('Error revoking share link: ' + err.message);
    }
}

function copyVerificationUrl() {
    if (currentVerificationUrl) {
        navigator.clipboard.writeText(currentVerificationUrl);
        alert('✓ Verification URL copied to clipboard!');
    }
}

function copyShareUrl() {
    if (currentShareUrl) {
        navigator.clipboard.writeText(currentShareUrl);
        alert('✓ Expiring Share Link copied to clipboard!');
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function saveHospitalReceptionSettings() {
    const settings = {
        hospName: document.getElementById('setHospName')?.value || 'SIT Students Hospital & Health Center',
        hospAddress: document.getElementById('setHospAddress')?.value || 'B.H. Road, SIT Campus, Tumakuru',
        receptionMode: document.getElementById('setReceptionMode')?.value || 'prepared',
        doctorSharingPolicy: document.getElementById('setDoctorSharingPolicy')?.value || 'all_hospital_doctors',
        labRouting: document.getElementById('setLabRouting')?.value || 'auto_notify',
        savedAt: new Date().toISOString()
    };
    localStorage.setItem('sit_hospital_reception_settings', JSON.stringify(settings));
    showToast('✓ SIT Students Hospital & Receptionist module settings saved!', 'success');
}

function resetHospitalReceptionSettings() {
    localStorage.removeItem('sit_hospital_reception_settings');
    if (document.getElementById('setHospName')) document.getElementById('setHospName').value = 'SIT Students Hospital & Health Center';
    if (document.getElementById('setHospAddress')) document.getElementById('setHospAddress').value = 'B.H. Road, SIT Campus, Tumakuru - 572103, Karnataka';
    if (document.getElementById('setReceptionMode')) document.getElementById('setReceptionMode').value = 'prepared';
    if (document.getElementById('setDoctorSharingPolicy')) document.getElementById('setDoctorSharingPolicy').value = 'all_hospital_doctors';
    if (document.getElementById('setLabRouting')) document.getElementById('setLabRouting').value = 'auto_notify';
    showToast('🔄 Reset to default SIT Students Hospital configuration.', 'info');
}

// Expose handlers globally on window object for inline onclick handlers
// ==========================================================================
// 15. DOCTOR OPD CHECKUP PRESCRIPTIONS & LAB REQUEST QUEUE
// ==========================================================================
async function loadPrescriptions() {
    const container = document.getElementById('prescriptionsListContainer');
    if (!container) return;

    try {
        let url = '/api/prescriptions';
        if (currentUser && currentUser.role === 'Doctor' && selectedDoctorPatientId) {
            url += `?patientId=${encodeURIComponent(selectedDoctorPatientId)}`;
        }
        const res = await fetch(url, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.prescriptions) || data.prescriptions.length === 0) {
            container.innerHTML = '<div style="padding: 1.25rem; color: var(--text-muted); text-align: center;">No OPD checkup prescriptions recorded for this patient yet.</div>';
            return;
        }

        container.innerHTML = data.prescriptions.map(rx => {
            const medsHtml = (rx.medicines || []).map(m => `
                <li style="margin-bottom: 3px;">
                    <strong>${escapeHtml(m.name)}</strong> — <span style="color: var(--accent-teal); font-weight: 700;">${escapeHtml(m.dosage || '1-0-1')}</span> (${escapeHtml(m.duration || '5 Days')}, ${escapeHtml(m.instructions || 'After Food')})
                </li>
            `).join('');

            return `
                <div class="theme-subbox" style="border-left: 4px solid var(--accent-blue); border-radius: 8px; padding: 1.15rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.65rem;">
                        <div>
                            <span class="report-id-badge">
                                ${escapeHtml(rx.prescriptionId)} • ${escapeHtml((rx.createdAt || '').slice(0, 10))}
                            </span>
                            <h4 style="font-size: 1.02rem; color: var(--text-primary); margin-top: 0.35rem;">
                                Patient: ${escapeHtml(rx.patientName)} (${escapeHtml(rx.patientUhid || '')} | ${escapeHtml(rx.billNumber || '')})
                            </h4>
                            <div style="font-size: 0.8rem; color: var(--text-secondary);">
                                Attending Doctor: <strong>${escapeHtml(rx.doctorName)}</strong> (${escapeHtml(rx.department || 'General Medicine')})
                            </div>
                        </div>
                        <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
                            <button type="button" class="btn btn-primary" style="font-size: 0.78rem; padding: 6px 12px;" onclick="downloadPrescriptionPdf('${escapeHtml(rx.prescriptionId)}')">
                                📄 Download Prescription PDF
                            </button>
                            ${rx.attachment ? `
                                <button type="button" class="btn btn-secondary" style="font-size: 0.78rem; padding: 6px 12px;" onclick="downloadPrescriptionAttachment('${escapeHtml(rx.prescriptionId)}', '${escapeHtml(rx.attachment.fileName || 'prescription_attachment')}')">
                                    📎 Download Attached File (${escapeHtml(rx.attachment.fileName || 'Document')})
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <div class="card" style="font-size: 0.82rem; padding: 0.6rem 0.8rem; border-radius: 6px; margin-bottom: 0.65rem;">
                        <div><strong>Vitals:</strong> ${escapeHtml(rx.vitals || 'Normal')}</div>
                        <div><strong>Complaints:</strong> ${escapeHtml(rx.symptoms || '-')}</div>
                        <div style="color: var(--accent-teal);"><strong>Clinical Diagnosis:</strong> ${escapeHtml(rx.diagnosis || '-')}</div>
                    </div>

                    <div style="font-size: 0.83rem; color: var(--text-primary); margin-bottom: 0.5rem;">
                        <strong>Rx — Prescribed Medicines:</strong>
                        <ul style="margin: 4px 0 0 18px; padding: 0;">${medsHtml}</ul>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; font-size: 0.78rem; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 0.5rem;">
                        <span><strong>Advice:</strong> ${escapeHtml(rx.advice || 'Follow dosage schedule')}</span>
                        ${rx.labTestOrdered && rx.labTestOrdered !== 'None' ? `<span class="report-eval-box" style="margin: 0; padding: 2px 8px;">🧪 Lab Ordered: ${escapeHtml(rx.labTestOrdered)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading prescriptions:', err);
    }
}

let isSubmittingPrescription = false;
const removingLabRequestIds = new Set();
let lastLabQueueRemoveAt = 0;

async function handleCreatePrescription(e) {
    e.preventDefault();
    if (isSubmittingPrescription) return;
    isSubmittingPrescription = true;

    const btn = document.getElementById('btnSubmitPrescription');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving Checkup & Generating Prescription...';
    }

    try {
        const rawLines = (document.getElementById('rxMedicinesInput')?.value || '').split('\n').map(l => l.trim()).filter(Boolean);
        const medicines = rawLines.map(line => {
            const parts = line.split('|').map(p => p.trim());
            return {
                name: parts[0] || line,
                dosage: parts[1] || '1 - 0 - 1',
                duration: parts[2] || '5 Days',
                instructions: parts[3] || 'After Food'
            };
        });

        const payload = {
            patientId: document.getElementById('rxPatientSelect')?.value,
            vitals: document.getElementById('rxVitalsInput')?.value,
            symptoms: document.getElementById('rxSymptomsInput')?.value,
            diagnosis: document.getElementById('rxDiagnosisInput')?.value,
            medicines,
            labTestOrdered: document.getElementById('rxLabTestOrder')?.value || 'None',
            followUpDate: document.getElementById('rxFollowUpInput')?.value || '',
            advice: document.getElementById('rxAdviceInput')?.value || ''
        };

        const res = await fetch('/api/prescriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert(data.message || 'Failed to save checkup prescription.');
            return;
        }

        showToast(`✓ ${data.message}`, 'success');
        if (document.getElementById('rxSymptomsInput')) document.getElementById('rxSymptomsInput').value = '';
        if (document.getElementById('rxDiagnosisInput')) document.getElementById('rxDiagnosisInput').value = '';
        await loadPrescriptions();
        await loadLabRequestsQueue();
    } catch (err) {
        const msg = err && err.message === 'Failed to fetch'
            ? 'Temporary connection hiccup while contacting the server. Refreshing queue to check if it already saved...'
            : ('Error creating prescription: ' + (err ? err.message : 'Unknown error'));
        showToast(msg, 'warning');
        alert(msg);
        await loadPrescriptions();
        await loadLabRequestsQueue();
    } finally {
        isSubmittingPrescription = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🩺 Save Checkup Prescription & Generate Official Slip';
        }
    }
}

async function loadLabRequestsQueue() {
    const tbody = document.getElementById('labRequestsTableBody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/lab-requests', { headers: getAuthHeaders() });
        const data = await res.json();
        if (!data.success || !Array.isArray(data.labRequests) || data.labRequests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No lab test orders queued.</td></tr>';
            return;
        }

        const canRemoveOrder = Boolean(currentUser && ['Lab Staff', 'Doctor', 'Admin'].includes(currentUser.role));

        tbody.innerHTML = data.labRequests.map(lr => {
            const isPending = lr.status === 'PENDING_UPLOAD';
            const badgeHtml = isPending
                ? '<span style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; font-weight: 700;">⏳ PENDING LAB UPLOAD</span>'
                : `<span style="background: #dcfce7; color: #166534; border: 1px solid #86efac; padding: 2px 8px; border-radius: 4px; font-size: 0.74rem; font-weight: 700;">✓ UPLOADED (${escapeHtml(lr.linkedReportId || 'Done')})</span>`;

            const safeIdAttr = escapeHtml(lr.requestId);
            const safePatientAttr = escapeHtml(lr.patientName || 'Patient').replace(/'/g, "\\'");
            const safeTitleAttr = escapeHtml(lr.testTitle || 'Lab Test').replace(/'/g, "\\'");
            const removeBtnHtml = canRemoveOrder
                ? `<button type="button" class="btn btn-secondary" data-remove-req="${safeIdAttr}" style="font-size: 0.72rem; padding: 4px 8px; color: var(--accent-danger); border-color: rgba(185, 28, 28, 0.35);" onclick="removeLabRequestFromQueue(this, '${safeIdAttr}', '${safePatientAttr}', '${safeTitleAttr}', ${isPending ? 'true' : 'false'})">${isPending ? '🗑️ Remove' : '✕ Clear'}</button>`
                : '';

            const actionHtml = isPending
                ? `<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <button type="button" class="btn btn-primary" style="font-size: 0.76rem; padding: 5px 10px;" onclick="selectLabRequestForUpload('${safeIdAttr}', '${escapeHtml(lr.patientId)}', '${safeTitleAttr}', '${escapeHtml(lr.reportType || 'Pathology / Biochemistry')}')">📤 Select &amp; Upload Report</button>
                        ${removeBtnHtml}
                   </div>`
                : `<div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        <span style="font-size: 0.76rem; color: var(--text-muted);">Anchored on Ledger</span>
                        ${removeBtnHtml}
                   </div>`;

            return `
                <tr>
                    <td style="font-family: var(--font-mono); font-weight: 700; font-size: 0.8rem;">${safeIdAttr}</td>
                    <td>
                        <strong>${escapeHtml(lr.patientName)}</strong><br/>
                        <span style="font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-muted);">${escapeHtml(lr.patientUhid || '')} | ${escapeHtml(lr.billNumber || '')}</span>
                    </td>
                    <td><strong>${escapeHtml(lr.testTitle)}</strong></td>
                    <td style="font-size: 0.82rem;">${escapeHtml(lr.requestedBy)}</td>
                    <td>${badgeHtml}</td>
                    <td>${actionHtml}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading lab requests queue:', err);
    }
}

async function removeLabRequestFromQueue(btnEl, requestId, patientName, testTitle, isPending) {
    // Double-click & rapid mis-click guard: ignore clicks if this order is already being removed or within 700ms cooldown
    const now = Date.now();
    if (!requestId || removingLabRequestIds.has(requestId) || (now - lastLabQueueRemoveAt) < 700) {
        return;
    }

    const promptMsg = isPending
        ? `Remove pending lab order ${requestId} ("${testTitle}" for ${patientName}) from the queue?`
        : `Clear completed lab order ${requestId} ("${testTitle}" for ${patientName}) from the queue?\n\nNote: This ONLY removes the queue entry — the uploaded report and Ethereum blockchain record remain permanently intact.`;

    if (!confirm(promptMsg)) {
        return;
    }

    removingLabRequestIds.add(requestId);
    lastLabQueueRemoveAt = Date.now();
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = 'Removing...';
    }

    try {
        const res = await fetch(`/api/lab-requests/${encodeURIComponent(requestId)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(`❌ ${data.message || 'Could not remove lab order.'}`, 'error');
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = isPending ? '🗑️ Remove' : '✕ Clear';
            }
            return;
        }

        // If this order was currently selected in the Upload form, clear the hidden binding
        const activeReqInput = document.getElementById('activeLabRequestId');
        if (activeReqInput && activeReqInput.value === requestId) {
            activeReqInput.value = '';
        }

        lastLabQueueRemoveAt = Date.now();
        showToast(`✓ ${data.message}`, 'success');
        await loadLabRequestsQueue();
    } catch (err) {
        showToast(`❌ Network error removing order: ${err.message}`, 'error');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = isPending ? '🗑️ Remove' : '✕ Clear';
        }
    } finally {
        removingLabRequestIds.delete(requestId);
    }
}

function selectLabRequestForUpload(requestId, patientId, testTitle, reportType) {
    const patSelect = document.getElementById('uploadPatient');
    const titleInput = document.getElementById('uploadTitle');
    const typeSelect = document.getElementById('uploadType');
    const reqInput = document.getElementById('activeLabRequestId');

    if (patSelect) patSelect.value = patientId;
    if (titleInput) titleInput.value = testTitle;
    if (typeSelect && reportType) typeSelect.value = reportType;
    if (reqInput) reqInput.value = requestId;

    showToast(`✓ Selected Lab Order ${requestId} for ${testTitle}. Attach the PDF file below to upload!`, 'info');
    const formEl = document.getElementById('uploadForm');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function initPortalTheme() {
    const savedTheme = localStorage.getItem('sit_hospital_theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    updateThemeToggleLabels();
}

function togglePortalTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('sit_hospital_theme', isDark ? 'dark' : 'light');
    updateThemeToggleLabels();
}

function updateThemeToggleLabels() {
    const isDark = document.body.classList.contains('dark-mode');
    document.querySelectorAll('.theme-toggle-label').forEach(el => {
        el.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    });
}

async function downloadPrescriptionPdf(prescriptionId) {
    try {
        const res = await fetch(`/api/prescriptions/${encodeURIComponent(prescriptionId)}/pdf`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.message || 'Failed to download prescription PDF.');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SIT_Hospital_Prescription_${prescriptionId}.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 150);
    } catch (err) {
        alert('Error downloading prescription PDF: ' + err.message);
    }
}

async function downloadPrescriptionAttachment(prescriptionId, fileName) {
    try {
        const res = await fetch(`/api/prescriptions/${encodeURIComponent(prescriptionId)}/attachment`, {
            headers: getAuthHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.message || 'Failed to download attached prescription document.');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || `${prescriptionId}_attachment`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 150);
    } catch (err) {
        alert('Error downloading attachment: ' + err.message);
    }
}

async function handleUploadPrescriptionDocument(e) {
    e.preventDefault();
    const fileInput = document.getElementById('rxAttachmentFileInput');
    const patSelect = document.getElementById('rxPatientSelect');
    const diagInput = document.getElementById('rxAttachmentDiagnosisInput');
    const btn = document.getElementById('btnUploadRxDoc');

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Please choose a prescription file to upload.');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = '🔒 Encrypting & Uploading...';
    }

    try {
        const formData = new FormData();
        formData.append('prescriptionFile', fileInput.files[0]);
        formData.append('patientId', patSelect ? patSelect.value : '');
        if (diagInput && diagInput.value.trim()) {
            formData.append('diagnosis', diagInput.value.trim());
        }

        const res = await fetch('/api/prescriptions/upload', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            alert(data.message || 'Failed to upload prescription document.');
            return;
        }

        showToast(`✓ ${data.message}`, 'success');
        fileInput.value = '';
        if (diagInput) diagInput.value = '';
        await loadPrescriptions();
    } catch (err) {
        alert('Prescription document upload error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔒 Encrypt & Upload Prescription Document';
        }
    }
}

window.togglePortalTheme = togglePortalTheme;
window.downloadPrescriptionPdf = downloadPrescriptionPdf;
window.downloadPrescriptionAttachment = downloadPrescriptionAttachment;
window.handleUploadPrescriptionDocument = handleUploadPrescriptionDocument;
window.revokeIssuedShareLink = revokeIssuedShareLink;
window.loginWithBillAndSecret = loginWithBillAndSecret;
window.loginAsDemoReceptionist = loginAsDemoReceptionist;
window.selectDoctorPatient = selectDoctorPatient;
window.clearDoctorSelectedPatient = clearDoctorSelectedPatient;
window.renderDoctorPatientDirectory = renderDoctorPatientDirectory;
window.openCheckupForSelectedPatient = openCheckupForSelectedPatient;
window.loadPrescriptions = loadPrescriptions;
window.handleCreatePrescription = handleCreatePrescription;
window.loadLabRequestsQueue = loadLabRequestsQueue;
window.selectLabRequestForUpload = selectLabRequestForUpload;
window.removeLabRequestFromQueue = removeLabRequestFromQueue;
window.saveHospitalReceptionSettings = saveHospitalReceptionSettings;
window.resetHospitalReceptionSettings = resetHospitalReceptionSettings;
window.loginWithBillNumber = loginWithBillAndSecret;
window.openReportModal = openReportModal;
window.downloadReportFile = downloadReportFile;
window.switchModalView = switchModalView;
window.showToast = showToast;
window.openQrModal = openQrModal;
window.openShareModal = openShareModal;
window.runLiveModalVerification = runLiveModalVerification;
window.copyVerificationUrl = copyVerificationUrl;
window.copyShareUrl = copyShareUrl;
window.closeModal = closeModal;
window.escapeHtml = escapeHtml;
window.loadAdminAiConfig = loadAdminAiConfig;
window.toggleApiKeyVisibility = toggleApiKeyVisibility;
window.saveAdminAiConfig = saveAdminAiConfig;
window.resetAdminAiConfig = resetAdminAiConfig;


