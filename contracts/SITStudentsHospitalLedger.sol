// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SITStudentsHospitalLedger
 * @notice Permissioned Single-Hospital Medical Report Anchoring & SHA-256 Deduplication Smart Contract
 * @dev Mirrors the built-in Node.js permissioned blockchain ledger (blockchain/Blockchain.js) for SIT Students Hospital
 */
contract SITStudentsHospitalLedger {
    address public hospitalAdmin;

    struct AnchoredReport {
        string reportId;
        string reportHash;        // SHA-256 cryptographic digest of the AES-256 encrypted report
        string storageReference;  // Off-chain encrypted file pointer
        string reportType;
        string patientPseudonym;  // e.g. PT-9901 (Zero PII stored on-chain)
        string departmentNodeId;  // e.g. NODE-LAB-01, NODE-HOSP-01
        uint256 anchoredAt;
        address anchoredBy;
        bool exists;
    }

    // Mapping from SHA-256 reportHash => bool (Objective 2: Cryptographic Duplicate Prevention)
    mapping(string => bool) private anchoredHashes;

    // Mapping from reportId => AnchoredReport
    mapping(string => AnchoredReport) private reportsById;

    // Ordered list of anchored report IDs
    string[] public reportIdList;

    // Authorized Hospital Department Nodes (Central Lab, Medicine Wing, Ortho/Pulmonary Wing)
    mapping(address => bool) public authorizedHospitalNodes;

    event ReportAnchored(
        string indexed reportId,
        string reportHash,
        string patientPseudonym,
        string departmentNodeId,
        uint256 timestamp
    );

    event DuplicateUploadRejected(
        string reportHash,
        address attemptedBy,
        uint256 timestamp
    );

    modifier onlyAuthorizedNode() {
        require(
            msg.sender == hospitalAdmin || authorizedHospitalNodes[msg.sender],
            "Access Denied: Only authorized SIT Students Hospital nodes can anchor reports"
        );
        _;
    }

    constructor() {
        hospitalAdmin = msg.sender;
        authorizedHospitalNodes[msg.sender] = true;
    }

    function authorizeDepartmentNode(address nodeAddress, bool status) external {
        require(msg.sender == hospitalAdmin, "Only Hospital Admin can manage department nodes");
        authorizedHospitalNodes[nodeAddress] = status;
    }

    /**
     * @notice Anchors a new diagnostic report's SHA-256 fingerprint on-chain after verifying it is not a duplicate
     */
    function anchorDiagnosticReport(
        string memory _reportId,
        string memory _reportHash,
        string memory _storageReference,
        string memory _reportType,
        string memory _patientPseudonym,
        string memory _departmentNodeId
    ) external onlyAuthorizedNode returns (bool) {
        require(!anchoredHashes[_reportHash], "HTTP 409 Conflict: Duplicate medical report SHA-256 hash rejected");
        require(!reportsById[_reportId].exists, "Report ID already exists on ledger");

        anchoredHashes[_reportHash] = true;
        reportsById[_reportId] = AnchoredReport({
            reportId: _reportId,
            reportHash: _reportHash,
            storageReference: _storageReference,
            reportType: _reportType,
            patientPseudonym: _patientPseudonym,
            departmentNodeId: _departmentNodeId,
            anchoredAt: block.timestamp,
            anchoredBy: msg.sender,
            exists: true
        });

        reportIdList.push(_reportId);

        emit ReportAnchored(_reportId, _reportHash, _patientPseudonym, _departmentNodeId, block.timestamp);
        return true;
    }

    /**
     * @notice Verifies if a live computed SHA-256 hash matches the immutable hash anchored on the ledger
     */
    function verifyReportIntegrity(
        string memory _reportId,
        string memory _liveComputedHash
    ) external view returns (bool isAuthentic, string memory anchoredHash, uint256 anchoredAt) {
        require(reportsById[_reportId].exists, "Report ID not found on SIT Students Hospital ledger");
        AnchoredReport memory rep = reportsById[_reportId];
        bool matchStatus = (keccak256(bytes(rep.reportHash)) == keccak256(bytes(_liveComputedHash)));
        return (matchStatus, rep.reportHash, rep.anchoredAt);
    }

    function isHashAlreadyAnchored(string memory _reportHash) external view returns (bool) {
        return anchoredHashes[_reportHash];
    }

    function getTotalAnchoredReports() external view returns (uint256) {
        return reportIdList.length;
    }
}
