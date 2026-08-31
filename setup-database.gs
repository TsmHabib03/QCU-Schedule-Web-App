// QCU Schedule Database Setup Script
// Run setupDatabase() from the Apps Script editor to create all sheets.

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheets().map(s => s.getName());
  let created = 0;
  let skipped = 0;

  const sheets = getSheetDefinitions();

  for (const [name, columns] of Object.entries(sheets)) {
    if (existing.includes(name)) {
      Logger.log('SKIP (exists): ' + name);
      skipped++;
      continue;
    }
    const sheet = ss.insertSheet(name);
    const headerRange = sheet.getRange(1, 1, 1, columns.length);
    headerRange.setValues([columns]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4A86C8');
    headerRange.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    Logger.log('CREATED: ' + name + ' (' + columns.length + ' columns)');
    created++;
  }

  Logger.log('Done. Created: ' + created + ', Skipped: ' + skipped);
  SpreadsheetApp.getUi().alert(
    'Database setup complete!\n\nCreated: ' + created + ' sheets\nSkipped: ' + skipped + ' (already exist)'
  );
}

function getSheetDefinitions() {
  return {
    "Users": ['userId', 'googleSub', 'email', 'emailVerified', 'displayName', 'avatarUrl', 'accountStatus', 'onboardingState', 'lastLoginAt', 'suspendedReason', 'closedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Student_Profiles": ['profileId', 'userId', 'studentNumber', 'firstName', 'middleName', 'lastName', 'suffix', 'preferredName', 'verificationStatus', 'sourceCorRecordId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Roles": ['roleId', 'roleKey', 'displayName', 'description', 'isSystemRole', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Capabilities": ['capabilityId', 'capabilityKey', 'description', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Role_Capabilities": ['roleCapabilityId', 'roleId', 'capabilityId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Role_Assignments": ['roleAssignmentId', 'userId', 'roleId', 'scopeType', 'scopeId', 'status', 'grantedBy', 'grantedAt', 'expiresAt', 'revokedAt', 'revokedBy', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Campuses": ['campusId', 'campusCode', 'name', 'shortName', 'timeZone', 'address', 'latitude', 'longitude', 'logoAssetKey', 'mapConfigKey', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Departments": ['departmentId', 'departmentCode', 'name', 'unitType', 'shortName', 'displayAbbreviation', 'logoAssetKey', 'parentDepartmentId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Programs": ['programId', 'departmentId', 'programCode', 'name', 'degreeLevel', 'shortName', 'description', 'logoAssetKey', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Program_Offerings": ['offeringId', 'programId', 'campusId', 'effectiveFromTermId', 'effectiveToTermId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Academic_Terms": ['termId', 'academicYearStart', 'academicYearLabel', 'termCode', 'name', 'startsOn', 'endsOn', 'enrollmentOpensOn', 'enrollmentClosesOn', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Sections": ['sectionId', 'offeringId', 'termId', 'sectionCode', 'yearLevel', 'displayName', 'adviserName', 'capacity', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Subjects": ['subjectId', 'subjectCode', 'title', 'description', 'defaultUnits', 'departmentId', 'colorKey', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Program_Subjects": ['programSubjectId', 'programId', 'subjectId', 'curriculumCode', 'recommendedYearLevel', 'recommendedTermCode', 'unitsOverride', 'effectiveFromTermId', 'effectiveToTermId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Enrollments": ['enrollmentId', 'ownerUserId', 'termId', 'offeringId', 'sectionId', 'sectionLabelSnapshot', 'yearLevel', 'studentStatus', 'dateEnrolled', 'adviserName', 'sourceType', 'sourceCorRecordId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Enrollment_Subjects": ['enrollmentSubjectId', 'enrollmentId', 'ownerUserId', 'subjectId', 'subjectCodeSnapshot', 'subjectTitleSnapshot', 'units', 'classSection', 'instructorName', 'sourceType', 'sourceCorDraftSubjectId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Schedules": ['scheduleId', 'enrollmentId', 'ownerUserId', 'revisionNumber', 'name', 'sourceType', 'sourceCorRecordId', 'status', 'activatedAt', 'archivedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Schedule_Entries": ['scheduleEntryId', 'scheduleId', 'ownerUserId', 'enrollmentSubjectId', 'dayOfWeek', 'startTime', 'endTime', 'modality', 'buildingId', 'roomId', 'locationText', 'effectiveFrom', 'effectiveTo', 'sourceCorDraftMeetingId', 'originType', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "COR_Records": ['corRecordId', 'ownerUserId', 'originalDocumentId', 'rawArtifactDocumentId', 'contentHash', 'status', 'providerKey', 'providerJobId', 'attemptCount', 'nextAttemptAt', 'leaseOwner', 'leaseExpiresAt', 'confidenceSummary', 'failureCode', 'failureMessage', 'draftVersion', 'confirmedAt', 'committedEnrollmentId', 'committedScheduleId', 'commitMutationId', 'completedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "COR_Extracted_Fields": ['corFieldId', 'corRecordId', 'ownerUserId', 'fieldKey', 'sourceText', 'normalizedValue', 'reviewedValue', 'resolvedEntityType', 'resolvedEntityId', 'confidence', 'reviewStatus', 'pageNumber', 'sourceRegion', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "COR_Draft_Subjects": ['corDraftSubjectId', 'corRecordId', 'ownerUserId', 'lineNumber', 'sourceLineText', 'sourceSubjectCode', 'sourceSubjectTitle', 'sourceUnits', 'reviewedSubjectCode', 'reviewedSubjectTitle', 'reviewedUnits', 'subjectId', 'classSection', 'instructorName', 'confidenceCode', 'confidenceTitle', 'confidenceUnits', 'pageNumber', 'reviewStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "COR_Draft_Meetings": ['corDraftMeetingId', 'corDraftSubjectId', 'ownerUserId', 'sequenceNumber', 'sourceScheduleText', 'sourceDay', 'sourceStartTime', 'sourceEndTime', 'sourceBuilding', 'sourceRoom', 'dayOfWeek', 'startTime', 'endTime', 'modality', 'buildingId', 'roomId', 'locationText', 'confidenceDay', 'confidenceTime', 'confidenceLocation', 'reviewStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Document_Assets": ['documentId', 'ownerUserId', 'corRecordId', 'assetType', 'driveFileId', 'originalFilename', 'mimeType', 'sizeBytes', 'contentHash', 'storageStatus', 'retentionUntil', 'deletedAt', 'deletionFailureCode', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Buildings": ['buildingId', 'buildingCode', 'name', 'shortName', 'campusId', 'description', 'imageAssetKey', 'latitude', 'longitude', 'floorCount', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Rooms": ['roomId', 'roomCode', 'name', 'buildingId', 'floorLabel', 'capacity', 'roomType', 'description', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Announcements": ['announcementId', 'title', 'body', 'audienceType', 'audienceId', 'publishAt', 'expiresAt', 'priority', 'sourceUrl', 'announcementStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Tasks": ['taskId', 'ownerUserId', 'title', 'description', 'enrollmentSubjectId', 'priority', 'dueAt', 'completedAt', 'taskStatus', 'clientMutationId', 'deletedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Notes": ['noteId', 'ownerUserId', 'title', 'body', 'enrollmentSubjectId', 'noteStatus', 'clientMutationId', 'deletedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "User_Settings": ['userSettingId', 'ownerUserId', 'settingKey', 'valueType', 'value', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "System_Settings": ['systemSettingId', 'settingKey', 'valueType', 'value', 'visibility', 'description', 'scopeType', 'scopeId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Audit_Log": ['auditEventId', 'occurredAt', 'requestId', 'actorType', 'actorUserId', 'action', 'targetType', 'targetId', 'result', 'scopeType', 'scopeId', 'summary', 'reason', 'ipHash', 'userAgentHash', 'metadata', 'retentionUntil'],
    "Mutation_Receipts": ['mutationReceiptId', 'actorUserId', 'clientMutationId', 'action', 'requestHash', 'resultStatus', 'targetType', 'targetId', 'responseReference', 'completedAt', 'errorCode', 'expiresAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'],
    "Schema_Migrations": ['migrationId', 'schemaVersion', 'migrationKey', 'description', 'appliedAt', 'appliedBy', 'checksum', 'backupReference', 'notes', 'status']
  };
}

function seedCatalogData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let seeded = 0;

  // Seed Campuses
  seedRows(ss, "Campuses", getSheetDefinitions()["Campuses"], [
    ['cam_sb', 'QCU-SB', 'QCU San Bartolome Campus', 'San Bartolome', 'Asia/Manila', '', '', '', '', '', 'ACTIVE'],
  ]);
  seeded++;

  // Seed Departments
  seedRows(ss, "Departments", getSheetDefinitions()["Departments"], [
    ['dep_ccs', 'CCS', 'College of Computer Studies', 'COLLEGE', 'CCS', 'CCS', 'college-ccs', '', 'ACTIVE'],
    ['dep_cbea', 'CBEA', 'College of Business Education and Arts', 'COLLEGE', 'CBEA', 'CBEA', 'college-cbea', '', 'ACTIVE'],
    ['dep_coed', 'COED', 'College of Education', 'COLLEGE', 'COED', 'COED', 'college-coed', '', 'ACTIVE'],
    ['dep_con', 'CON', 'College of Nursing', 'COLLEGE', 'CON', 'CON', 'college-con', '', 'ACTIVE'],
    ['dep_coe', 'COE', 'College of Engineering', 'COLLEGE', 'COE', 'COE', 'college-coe', '', 'ACTIVE'],
  ]);
  seeded++;

  // Seed Programs
  seedRows(ss, "Programs", getSheetDefinitions()["Programs"], [
    ['prg_bscs', 'dep_ccs', 'BSCS', 'Bachelor of Science in Computer Science', 'BACHELOR', 'BSCS', '', '', 'ACTIVE'],
    ['prg_bsit', 'dep_ccs', 'BSIT', 'Bachelor of Science in Information Technology', 'BACHELOR', 'BSIT', '', '', 'ACTIVE'],
    ['prg_bsba', 'dep_cbea', 'BSBA', 'Bachelor of Science in Business Administration', 'BACHELOR', 'BSBA', '', '', 'ACTIVE'],
    ['prg_beed', 'dep_coed', 'BEED', 'Bachelor of Elementary Education', 'BACHELOR', 'BEED', '', '', 'ACTIVE'],
    ['prg_bsed', 'dep_coed', 'BSED', 'Bachelor of Secondary Education', 'BACHELOR', 'BSED', '', '', 'ACTIVE'],
    ['prg_bsn', 'dep_con', 'BSN', 'Bachelor of Science in Nursing', 'BACHELOR', 'BSN', '', '', 'ACTIVE'],
    ['prg_bsee', 'dep_coe', 'BSEE', 'Bachelor of Science in Electrical Engineering', 'BACHELOR', 'BSEE', '', '', 'ACTIVE'],
    ['prg_ce', 'dep_coe', 'CE', 'Bachelor of Science in Civil Engineering', 'BACHELOR', 'CE', '', '', 'ACTIVE'],
  ]);
  seeded++;

  // Seed Academic Terms
  seedRows(ss, "Academic_Terms", getSheetDefinitions()["Academic_Terms"], [
    ['trm_2026_1', 2026, '2026-2027', 'FIRST_SEMESTER', 'First Semester AY 2026-2027', '2026-08-01', '2026-12-20', '2026-06-01', '2026-07-31', 'ACTIVE'],
  ]);
  seeded++;

  // Seed Roles
  seedRows(ss, "Roles", getSheetDefinitions()["Roles"], [
    ['rol_student', 'STUDENT', 'Student', 'Default student role', 'true', 'ACTIVE'],
    ['rol_admin', 'ADMINISTRATOR', 'Administrator', 'Platform administrator', 'true', 'ACTIVE'],
  ]);
  seeded++;

  // Seed Capabilities
  seedRows(ss, "Capabilities", getSheetDefinitions()["Capabilities"], [
    ['cap_catalog_read', 'catalog.read', 'Read shared catalog data', 'ACTIVE'],
    ['cap_catalog_write', 'catalog.write', 'Manage shared catalog data', 'ACTIVE'],
    ['cap_users_read', 'users.read', 'Read user accounts', 'ACTIVE'],
    ['cap_users_status_write', 'users.status.write', 'Change user account status', 'ACTIVE'],
    ['cap_roles_read', 'roles.read', 'Read roles and assignments', 'ACTIVE'],
    ['cap_roles_manage', 'roles.manage', 'Manage roles and assignments', 'ACTIVE'],
    ['cap_imports_review', 'imports.review', 'Review COR imports', 'ACTIVE'],
    ['cap_documents_read', 'documents.read.support', 'Read documents for support', 'ACTIVE'],
    ['cap_audit_read', 'audit.read', 'Read audit log', 'ACTIVE'],
    ['cap_sysconfig_read', 'system.config.read', 'Read system configuration', 'ACTIVE'],
    ['cap_sysconfig_write', 'system.config.write', 'Write system configuration', 'ACTIVE'],
    ['cap_announcements_write', 'announcements.write', 'Manage announcements', 'ACTIVE'],
  ]);
  seeded++;

  SpreadsheetApp.getUi().alert('Catalog seed complete! Seeded ' + seeded + ' sheets.');
}

function seedRows(ss, sheetName, columns, rows) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('Sheet not found: ' + sheetName);
    return;
  }
  if (sheet.getLastRow() > 1) {
    Logger.log('Sheet already has data, skipping: ' + sheetName);
    return;
  }
  if (rows.length === 0) return;
  const colCount = columns.length;
  const padded = rows.map(row => {
    const r = row.slice();
    while (r.length < colCount) r.push(null);
    return r;
  });
  const startRow = 2;
  const range = sheet.getRange(startRow, 1, padded.length, colCount);
  range.setValues(padded);
  Logger.log('Seeded ' + padded.length + ' rows into ' + sheetName);
}

// Web app entry point — receives signed requests from Cloudflare
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const payload = data.payload || {};
    const actor = data.actor || {};

    // TODO: Verify HMAC signature from Cloudflare
    // TODO: Resolve actor identity from Users sheet
    // TODO: Authorization checks

    switch (action) {
      case "bootstrap.read":
        return handleBootstrap(actor, payload);
      case "profile.read":
        return handleProfileRead(actor, payload);
      case "catalog.list":
        return handleCatalogList(actor, payload);
      case "task.create":
        return handleTaskCreate(actor, payload);
      case "task.list":
        return handleTaskList(actor, payload);
      case "note.create":
        return handleNoteCreate(actor, payload);
      case "note.list":
        return handleNoteList(actor, payload);
      case "schedule.active.read":
        return handleScheduleRead(actor, payload);
      default:
        return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "Unknown action: " + action } }, 404);
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: "Server error" } }, 500);
  }
}

function handleBootstrap(actor, payload) {
  // TODO: Look up user in Users sheet by googleSub
  // TODO: Return user info, roles, active enrollment/schedule
  return jsonResponse({ ok: true, data: { user: null, onboardingState: "AWAITING_COR" } });
}

function handleProfileRead(actor, payload) {
  return jsonResponse({ ok: true, data: {} });
}

function handleCatalogList(actor, payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const entity = payload.entity || 'campuses';
  const sheetMap = {
    campuses: "Campuses",
    departments: "Departments",
    programs: "Programs",
    terms: "Academic_Terms",
    subjects: "Subjects",
    buildings: "Buildings",
    rooms: "Rooms"
  };
  const sheetName = sheetMap[entity];
  if (!sheetName) return jsonResponse({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown catalog entity' } }, 404);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return jsonResponse({ ok: true, data: { rows: [] } });
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return jsonResponse({ ok: true, data: { rows: [] } });
  const headers = data[0];
  const rows = data.slice(1).filter(r => r[headers.indexOf('status')] === 'ACTIVE').map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i] || null);
    return obj;
  });
  return jsonResponse({ ok: true, data: { rows, total: rows.length } });
}

function handleTaskCreate(actor, payload) {
  return jsonResponse({ ok: true, data: { taskId: "tsk_dev_001" } });
}

function handleTaskList(actor, payload) {
  return jsonResponse({ ok: true, data: { rows: [], total: 0 } });
}

function handleNoteCreate(actor, payload) {
  return jsonResponse({ ok: true, data: { noteId: "nte_dev_001" } });
}

function handleNoteList(actor, payload) {
  return jsonResponse({ ok: true, data: { rows: [], total: 0 } });
}

function handleScheduleRead(actor, payload) {
  return jsonResponse({ ok: true, data: { schedule: null, entries: [] } });
}

function jsonResponse(data, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === "health") {
    return jsonResponse({ ok: true, status: "healthy", sheets: Object.keys(getSheetDefinitions()).length });
  }
  return jsonResponse({ ok: true, message: "QCU Schedule API" });
}