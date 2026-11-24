document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.getItem('sit_hospital_theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }
    const reportIdInput = document.getElementById('reportIdInput');
    const runVerifyBtn = document.getElementById('runVerifyBtn');
    const resultCard = document.getElementById('resultCard');
    const statusBadge = document.getElementById('statusBadge');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const statusDesc = document.getElementById('statusDesc');
    const liveHashDisplay = document.getElementById('liveHashDisplay');
    const anchoredHashDisplay = document.getElementById('anchoredHashDisplay');
    const matchSummary = document.getElementById('matchSummary');
    const resReportId = document.getElementById('resReportId');
    const resPatient = document.getElementById('resPatient');
    const resBlockIndex = document.getElementById('resBlockIndex');
    const resNode = document.getElementById('resNode');
    const resBlockHash = document.getElementById('resBlockHash');
    const resTimestamp = document.getElementById('resTimestamp');
    const tamperFileBtn = document.getElementById('tamperFileBtn');
    const repairFileBtn = document.getElementById('repairFileBtn');

    function getOptionalAuthHeaders() {
        const token = localStorage.getItem('hc_auth_token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    // Show DEMO_MODE controls only when server explicitly reports DEMO_MODE=true
    try {
        const cfgRes = await fetch('/api/config/public');
        if (cfgRes.ok) {
            const cfg = await cfgRes.json();
            if (cfg.demoMode) {
                const chips = document.getElementById('verifyDemoChipsRow');
                const actions = document.getElementById('verifyDemoActionsSection');
                if (chips) chips.style.display = 'flex';
                if (actions) actions.style.display = 'flex';
            }
        }
    } catch (_) {}

    const urlParams = new URLSearchParams(window.location.search);
    const initialReportId = urlParams.get('reportId');
    if (initialReportId) {
        reportIdInput.value = initialReportId;
        verifyReport(initialReportId);
    }

    window.setQuickReport = function (id) {
        reportIdInput.value = id;
        verifyReport(id);
    };

    runVerifyBtn.addEventListener('click', () => {
        const id = reportIdInput.value.trim();
        if (!id) {
            alert('Please enter a Report ID.');
            return;
        }
        verifyReport(id);
    });

    async function verifyReport(reportId) {
        runVerifyBtn.disabled = true;
        runVerifyBtn.textContent = '⏳ Checking Cryptographic Integrity...';

        try {
            const res = await fetch(`/api/verify/${encodeURIComponent(reportId)}`, {
                headers: getOptionalAuthHeaders()
            });
            const data = await res.json();

            resultCard.style.display = 'block';

            if (!data.success) {
                statusBadge.className = 'status-badge-big status-badge-mismatch';
                statusIcon.textContent = '✕';
                statusText.textContent = data.status === 'NOT_FOUND' ? 'REPORT NOT FOUND' : 'VERIFICATION ERROR';
                statusDesc.textContent = data.message || 'No matching record exists.';
                liveHashDisplay.textContent = 'N/A';
                anchoredHashDisplay.textContent = 'N/A';
                matchSummary.textContent = data.message || 'Verification unavailable.';
                return;
            }

            const bDetails = data.blockchainDetails || {};
            resReportId.textContent = data.reportId;
            resPatient.textContent = data.patientName
                ? `${data.patientName} (${data.patientPseudonym || ''})`
                : 'Protected (Public privacy mode — sign in to view clinical identity)';
            resBlockIndex.textContent = `Block #${bDetails.blockIndex ?? data.blockIndex ?? '-'}`;
            resNode.textContent = bDetails.institutionNode || 'SIT Students Hospital';
            resBlockHash.textContent = bDetails.blockHash || 'Visible to authorized logged-in viewers';
            const ts = bDetails.timestamp || data.anchoredAt;
            resTimestamp.textContent = ts ? new Date(ts).toLocaleString() : 'N/A';

            liveHashDisplay.textContent = data.liveComputedHash || 'Verified server-side (sign in as authorized user to inspect full digest)';
            anchoredHashDisplay.textContent = data.anchoredBlockchainHash || 'Verified server-side against anchored digest';

            const ethNote = (data.onChainVerification && data.onChainVerification.checkedOnChain)
                ? ` • Ethereum On-Chain (${data.onChainVerification.network}): ${data.onChainVerification.onChainAuthentic ? 'CONFIRMED' : 'MISMATCH'}`
                : '';

            if (data.isAuthentic) {
                statusBadge.className = 'status-badge-big status-badge-match';
                statusIcon.textContent = '✓';
                statusText.textContent = 'MATCH: REPORT AUTHENTIC';
                statusDesc.textContent = (data.verificationMessage || 'Authentic report.') + ethNote;
                matchSummary.innerHTML = `<span class="verify-match-ok">✓ Cryptographic integrity verified.${ethNote}</span>`;
            } else {
                statusBadge.className = 'status-badge-big status-badge-mismatch';
                statusIcon.textContent = '⚠️';
                statusText.textContent = 'MISMATCH: TAMPERING DETECTED';
                statusDesc.textContent = data.verificationMessage || 'Integrity check failed.';
                matchSummary.innerHTML = '<span class="verify-match-err">⚠️ ALERT: Document integrity mismatch detected!</span>';
            }
        } catch (err) {
            alert('Failed to connect to verification API: ' + err.message);
        } finally {
            runVerifyBtn.disabled = false;
            runVerifyBtn.textContent = '🔒 Verify Integrity on Blockchain';
        }
    }

    if (tamperFileBtn) {
        tamperFileBtn.addEventListener('click', async () => {
            const id = reportIdInput.value.trim();
            if (!id) return;
            if (!confirm(`Activate non-destructive in-memory tamper simulation for ${id}? (Requires Admin login in DEMO_MODE; files on disk are NOT modified.)`)) return;
            try {
                const res = await fetch(`/api/verify/simulate-tamper/${encodeURIComponent(id)}`, {
                    method: 'POST',
                    headers: getOptionalAuthHeaders()
                });
                const data = await res.json();
                alert(data.message || 'Done');
                verifyReport(id);
            } catch (e) {
                alert('Tamper simulation failed: ' + e.message);
            }
        });
    }

    if (repairFileBtn) {
        repairFileBtn.addEventListener('click', async () => {
            const id = reportIdInput.value.trim();
            if (!id) return;
            try {
                const res = await fetch(`/api/verify/reset-tamper/${encodeURIComponent(id)}`, {
                    method: 'POST',
                    headers: getOptionalAuthHeaders()
                });
                const data = await res.json();
                alert(data.message || 'Simulation reset.');
                verifyReport(id);
            } catch (e) {
                alert('Reset failed: ' + e.message);
            }
        });
    }
});
