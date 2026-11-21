// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SITStudentsHospitalLedger
 * @notice On-chain Medical Report Anchoring & SHA-256 Deduplication Smart Contract for SIT Students Hospital
 * @dev Stores ONLY pseudonymous IDs, SHA-256 source/document hashes, and storage pointers (Zero PII on-chain)
 */
contract SITStudentsHospitalLedger {
    address public hospitalAdmin;

    struct AnchoredReport {
        string reportId;
        string sourceHash;        // SHA-256 digest of the original uploaded source file
        string reportHash;        // SHA-256 digest of the stored standardized PDF document
        string storageReference;  // Off-chain AES-256-GCM encrypted file pointer
        string reportType;
        string patientPseudonym;  // e.g. PT-9901 (Zero PII stored on-chain)
        string departmentNodeId;  // e.g. NODE-LAB-01, NODE-HOSP-01
        uint256 anchoredAt;
        address anchoredBy;
        bool exists;
    }

    // Mapping from SHA-256 hash (source or stored) => bool (Cryptographic Duplicate Prevention)
    mapping(string => bool) private anchoredHashes;

    // Mapping from reportId => AnchoredReport
    mapping(string => AnchoredReport) private reportsById;

    // Ordered list of anchored report IDs
    string[] public reportIdList;

    // Authorized Hospital Department Signers
    mapping(address => bool) public authorizedHospitalNodes;

    event ReportAnchored(
        string indexed reportId,
        string sourceHash,
        string reportHash,
        string patientPseudonym,
        string departmentNodeId,
        uint256 timestamp
    );

    modifier onlyAuthorizedNode() {
        require(
            msg.sender == hospitalAdmin || authorizedHospitalNodes[msg.sender],
            "Access Denied: Only authorized SIT Students Hospital signers can anchor reports"
        );
        _;
    }

    constructor() {
        hospitalAdmin = msg.sender;
        authorizedHospitalNodes[msg.sender] = true;
    }

    function authorizeDepartmentNode(address nodeAddress, bool status) external {
        require(msg.sender == hospitalAdmin, "Only Hospital Admin can manage authorized signers");
        authorizedHospitalNodes[nodeAddress] = status;
    }

    /**
     * @notice Anchors a new diagnostic report's sourceHash and reportHash on-chain after rejecting duplicates
     */
    function anchorDiagnosticReport(
        string memory _reportId,
        string memory _sourceHash,
        string memory _reportHash,
        string memory _storageReference,
        string memory _reportType,
        string memory _patientPseudonym,
        string memory _departmentNodeId
    ) external onlyAuthorizedNode returns (bool) {
        require(!anchoredHashes[_sourceHash], "Duplicate medical report sourceHash rejected");
        require(!anchoredHashes[_reportHash], "Duplicate medical report reportHash rejected");
        require(!reportsById[_reportId].exists, "Report ID already exists on blockchain");

        anchoredHashes[_sourceHash] = true;
        anchoredHashes[_reportHash] = true;

        reportsById[_reportId] = AnchoredReport({
            reportId: _reportId,
            sourceHash: _sourceHash,
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

        emit ReportAnchored(_reportId, _sourceHash, _reportHash, _patientPseudonym, _departmentNodeId, block.timestamp);
        return true;
    }

    /**
     * @notice Verifies if a live computed SHA-256 hash matches the immutable hash anchored on-chain
     */
    function verifyReportIntegrity(
        string memory _reportId,
        string memory _liveComputedHash
    ) external view returns (bool isAuthentic, string memory anchoredHash, uint256 anchoredAt) {
        require(reportsById[_reportId].exists, "Report ID not found on SIT Students Hospital contract");
        AnchoredReport memory rep = reportsById[_reportId];
        bool matchStatus = (keccak256(bytes(rep.reportHash)) == keccak256(bytes(_liveComputedHash)));
        return (matchStatus, rep.reportHash, rep.anchoredAt);
    }

    function isHashAlreadyAnchored(string memory _hash) external view returns (bool) {
        return anchoredHashes[_hash];
    }

    function getTotalAnchoredReports() external view returns (uint256) {
        return reportIdList.length;
    }
}
