// QCU Schedule — Google Sheets database + API layer (Apps Script)
//
// Deploy as: Extensions > Apps Script > Deploy > New deployment > Web app
//   Execute as:      Me
//   Who has access:  Anyone
// Then copy the /exec URL into the Cloudflare Pages env var APPS_SCRIPT_URL,
// and set the same shared secret in BOTH places:
//   - Apps Script:      Project Settings > Script properties > APPS_SCRIPT_SECRET
//   - Cloudflare Pages: Settings > Environment variables > APPS_SCRIPT_SECRET
//
// One-time setup, run from the editor in this order:
//   1. setupDatabase()    - creates every sheet, adds any missing columns
//   2. seedCatalogData()  - seeds campuses/departments/programs/terms/roles
//
// Request contract (see DATABASE.md section 15). Cloudflare POSTs:
//   { "canonical": "<exact JSON string>", "signature": "<hex hmac-sha256>" }
// The HMAC covers the `canonical` string verbatim, so neither side depends on
// JSON key ordering. `canonical` parses to:
//   { requestId, timestamp, nonce, action, actor: { googleSub, email }, payload }

var SCHEMA_VERSION = 2;
var API_VERSION = 'v1';
var MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
var LOCK_TIMEOUT_MS = 30 * 1000;
var NONCE_TTL_SECONDS = 600;

// ---------------------------------------------------------------------------
// Sheet definitions
// ---------------------------------------------------------------------------
// `extraJson` on user-owned sheets holds any application field with no
// dedicated column, keeping the round-trip lossless while the visible columns
// stay readable in the spreadsheet.

function getSheetDefinitions() {
  var D = {};

  D['Users'] = ['userId', 'googleSub', 'email', 'emailVerified', 'displayName', 'avatarUrl', 'accountStatus', 'onboardingState', 'lastLoginAt', 'suspendedReason', 'closedAt', 'sessionsRevokedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['Student_Profiles'] = ['profileId', 'userId', 'studentNumber', 'firstName', 'middleName', 'lastName', 'suffix', 'preferredName', 'verificationStatus', 'sourceCorRecordId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['Roles'] = ['roleId', 'roleKey', 'displayName', 'description', 'isSystemRole', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Capabilities'] = ['capabilityId', 'capabilityKey', 'description', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Role_Capabilities'] = ['roleCapabilityId', 'roleId', 'capabilityId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Role_Assignments'] = ['roleAssignmentId', 'userId', 'roleId', 'scopeType', 'scopeId', 'status', 'grantedBy', 'grantedAt', 'expiresAt', 'revokedAt', 'revokedBy', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Campuses'] = ['campusId', 'campusCode', 'name', 'shortName', 'timeZone', 'address', 'latitude', 'longitude', 'logoAssetKey', 'mapConfigKey', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Departments'] = ['departmentId', 'departmentCode', 'name', 'unitType', 'shortName', 'displayAbbreviation', 'logoAssetKey', 'parentDepartmentId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Programs'] = ['programId', 'departmentId', 'programCode', 'name', 'degreeLevel', 'shortName', 'description', 'logoAssetKey', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Program_Offerings'] = ['offeringId', 'programId', 'campusId', 'effectiveFromTermId', 'effectiveToTermId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Academic_Terms'] = ['termId', 'academicYearStart', 'academicYearLabel', 'termCode', 'name', 'startsOn', 'endsOn', 'enrollmentOpensOn', 'enrollmentClosesOn', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Sections'] = ['sectionId', 'offeringId', 'termId', 'sectionCode', 'yearLevel', 'displayName', 'adviserName', 'capacity', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Subjects'] = ['subjectId', 'subjectCode', 'title', 'description', 'defaultUnits', 'departmentId', 'colorKey', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Program_Subjects'] = ['programSubjectId', 'programId', 'subjectId', 'curriculumCode', 'recommendedYearLevel', 'recommendedTermCode', 'unitsOverride', 'effectiveFromTermId', 'effectiveToTermId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];

  D['Enrollments'] = ['enrollmentId', 'ownerUserId', 'termId', 'offeringId', 'sectionId', 'sectionLabelSnapshot', 'yearLevel', 'studentStatus', 'dateEnrolled', 'adviserName', 'sourceType', 'sourceCorRecordId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['Enrollment_Subjects'] = ['enrollmentSubjectId', 'enrollmentId', 'ownerUserId', 'subjectId', 'subjectCodeSnapshot', 'subjectTitleSnapshot', 'units', 'classSection', 'instructorName', 'sourceType', 'sourceCorDraftSubjectId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['Schedules'] = ['scheduleId', 'enrollmentId', 'ownerUserId', 'revisionNumber', 'name', 'sourceType', 'sourceCorRecordId', 'status', 'activatedAt', 'archivedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['Schedule_Entries'] = ['scheduleEntryId', 'scheduleId', 'ownerUserId', 'enrollmentSubjectId', 'dayOfWeek', 'startTime', 'endTime', 'modality', 'buildingId', 'roomId', 'locationText', 'effectiveFrom', 'effectiveTo', 'sourceCorDraftMeetingId', 'originType', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['COR_Records'] = ['corRecordId', 'ownerUserId', 'originalDocumentId', 'rawArtifactDocumentId', 'contentHash', 'status', 'providerKey', 'providerJobId', 'attemptCount', 'nextAttemptAt', 'leaseOwner', 'leaseExpiresAt', 'confidenceSummary', 'failureCode', 'failureMessage', 'draftVersion', 'confirmedAt', 'committedEnrollmentId', 'committedScheduleId', 'commitMutationId', 'completedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['COR_Drafts'] = ['corRecordId', 'ownerUserId', 'draftVersion', 'draftJson', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['COR_Extracted_Fields'] = ['corFieldId', 'corRecordId', 'ownerUserId', 'fieldKey', 'sourceText', 'normalizedValue', 'reviewedValue', 'resolvedEntityType', 'resolvedEntityId', 'confidence', 'reviewStatus', 'pageNumber', 'sourceRegion', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['COR_Draft_Subjects'] = ['corDraftSubjectId', 'corRecordId', 'ownerUserId', 'lineNumber', 'sourceLineText', 'sourceSubjectCode', 'sourceSubjectTitle', 'sourceUnits', 'reviewedSubjectCode', 'reviewedSubjectTitle', 'reviewedUnits', 'subjectId', 'classSection', 'instructorName', 'confidenceCode', 'confidenceTitle', 'confidenceUnits', 'pageNumber', 'reviewStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['COR_Draft_Meetings'] = ['corDraftMeetingId', 'corDraftSubjectId', 'ownerUserId', 'sequenceNumber', 'sourceScheduleText', 'sourceDay', 'sourceStartTime', 'sourceEndTime', 'sourceBuilding', 'sourceRoom', 'dayOfWeek', 'startTime', 'endTime', 'modality', 'buildingId', 'roomId', 'locationText', 'confidenceDay', 'confidenceTime', 'confidenceLocation', 'reviewStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Document_Assets'] = ['documentId', 'ownerUserId', 'corRecordId', 'assetType', 'driveFileId', 'originalFilename', 'mimeType', 'sizeBytes', 'contentHash', 'storageStatus', 'retentionUntil', 'deletedAt', 'deletionFailureCode', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Buildings'] = ['buildingId', 'buildingCode', 'name', 'shortName', 'campusId', 'description', 'imageAssetKey', 'latitude', 'longitude', 'floorCount', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Rooms'] = ['roomId', 'roomCode', 'name', 'buildingId', 'floorLabel', 'capacity', 'roomType', 'description', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Announcements'] = ['announcementId', 'title', 'body', 'audienceType', 'audienceId', 'publishAt', 'expiresAt', 'priority', 'sourceUrl', 'announcementStatus', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Tasks'] = ['taskId', 'ownerUserId', 'title', 'description', 'enrollmentSubjectId', 'priority', 'dueAt', 'completedAt', 'taskStatus', 'clientMutationId', 'deletedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['Notes'] = ['noteId', 'ownerUserId', 'title', 'body', 'enrollmentSubjectId', 'noteStatus', 'clientMutationId', 'deletedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version', 'extraJson'];
  D['User_Settings'] = ['userSettingId', 'ownerUserId', 'settingKey', 'valueType', 'value', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['System_Settings'] = ['systemSettingId', 'settingKey', 'valueType', 'value', 'visibility', 'description', 'scopeType', 'scopeId', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Audit_Log'] = ['auditEventId', 'occurredAt', 'requestId', 'actorType', 'actorUserId', 'action', 'targetType', 'targetId', 'result', 'scopeType', 'scopeId', 'summary', 'reason', 'ipHash', 'userAgentHash', 'metadata', 'retentionUntil'];
  D['Mutation_Receipts'] = ['mutationReceiptId', 'actorUserId', 'clientMutationId', 'action', 'requestHash', 'resultStatus', 'targetType', 'targetId', 'responseReference', 'completedAt', 'errorCode', 'expiresAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'version'];
  D['Schema_Migrations'] = ['migrationId', 'schemaVersion', 'migrationKey', 'description', 'appliedAt', 'appliedBy', 'checksum', 'backupReference', 'notes', 'status'];

  return D;
}

// ---------------------------------------------------------------------------
// Entity registry — maps a logical kind to its sheet, primary key and owner
// ---------------------------------------------------------------------------
// `snapshot.read` and `batch.write` are driven entirely by this table, so
// adding a user-owned entity is a one-line change.

function getEntityRegistry() {
  return {
    users:              { sheet: 'Users',               pk: 'userId',              owner: null },
    profiles:           { sheet: 'Student_Profiles',    pk: 'profileId',           owner: 'userId' },
    corRecords:         { sheet: 'COR_Records',         pk: 'corRecordId',         owner: 'ownerUserId' },
    corDrafts:          { sheet: 'COR_Drafts',          pk: 'corRecordId',         owner: 'ownerUserId' },
    enrollments:        { sheet: 'Enrollments',         pk: 'enrollmentId',        owner: 'ownerUserId' },
    enrollmentSubjects: { sheet: 'Enrollment_Subjects', pk: 'enrollmentSubjectId', owner: 'ownerUserId' },
    schedules:          { sheet: 'Schedules',           pk: 'scheduleId',          owner: 'ownerUserId' },
    scheduleEntries:    { sheet: 'Schedule_Entries',    pk: 'scheduleEntryId',     owner: 'ownerUserId' },
    tasks:              { sheet: 'Tasks',               pk: 'taskId',              owner: 'ownerUserId' },
    notes:              { sheet: 'Notes',               pk: 'noteId',              owner: 'ownerUserId' }
  };
}

// ---------------------------------------------------------------------------
// One-time setup / migration
// ---------------------------------------------------------------------------

/**
 * Create every missing sheet and append any column that a definition gained
 * since the sheet was created. Safe to re-run; never deletes or reorders
 * existing columns, so live data survives a schema bump.
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var defs = getSheetDefinitions();
  var created = 0, migrated = 0, unchanged = 0;
  var names = Object.keys(defs);

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var columns = defs[name];
    var sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      writeHeaderRow(sheet, columns);
      Logger.log('CREATED: ' + name + ' (' + columns.length + ' columns)');
      created++;
      continue;
    }

    var added = addMissingColumns(sheet, columns);
    if (added.length) {
      Logger.log('MIGRATED: ' + name + ' +[' + added.join(', ') + ']');
      migrated++;
    } else {
      unchanged++;
    }
  }

  recordMigration(ss, 'setupDatabase', 'Sheets created/migrated to schema v' + SCHEMA_VERSION);

  var summary = 'Created: ' + created + '\nMigrated: ' + migrated + '\nUnchanged: ' + unchanged;
  Logger.log('Done. ' + summary.replace(/\n/g, ', '));
  try {
    SpreadsheetApp.getUi().alert('Database setup complete!\n\n' + summary);
  } catch (e) {
    // No UI when run from a trigger or the API — the log is enough.
  }
}

function writeHeaderRow(sheet, columns) {
  var range = sheet.getRange(1, 1, 1, columns.length);
  range.setValues([columns]);
  range.setFontWeight('bold');
  range.setBackground('#4A86C8');
  range.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
}

/** Append columns present in `columns` but missing from the sheet header. */
function addMissingColumns(sheet, columns) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < header.length; i++) {
    if (header[i]) have[String(header[i])] = true;
  }
  var missing = [];
  for (var j = 0; j < columns.length; j++) {
    if (!have[columns[j]]) missing.push(columns[j]);
  }
  if (!missing.length) return [];

  var startCol = header.length + 1;
  // A brand-new sheet reports lastColumn 1 with an empty header cell.
  if (header.length === 1 && !header[0]) startCol = 1;

  var range = sheet.getRange(1, startCol, 1, missing.length);
  range.setValues([missing]);
  range.setFontWeight('bold');
  range.setBackground('#4A86C8');
  range.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  return missing;
}

function recordMigration(ss, key, description) {
  var sheet = ss.getSheetByName('Schema_Migrations');
  if (!sheet) return;
  sheet.appendRow([
    'mig_' + Date.now(), SCHEMA_VERSION, key, description,
    new Date().toISOString(), 'setup-script', '', '', '', 'APPLIED'
  ]);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------
// The academic catalog (campuses, departments, programs, terms, subjects,
// buildings, rooms) is NOT hand-maintained here. It lives in
// data/academic-catalog.json, is embedded into the Cloudflare Functions bundle
// as functions/api/repo/catalog-seed.js, and is pushed into these sheets by the
// `catalog.sync` action. That keeps one source of truth and makes drift between
// the app and the spreadsheet impossible.
//
// seedCatalogData() only seeds identity rows that the academic catalog does not
// describe: roles, capabilities and their mapping.

function seedCatalogData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ts = new Date().toISOString();
  var seeded = 0;

  seeded += seedRows(ss, 'Roles', [
    ['rol_student', 'STUDENT', 'Student', 'Default student role', true, 'ACTIVE', ts, 'seed', ts, 'seed', 1],
    ['rol_admin', 'ADMINISTRATOR', 'Administrator', 'Platform administrator', true, 'ACTIVE', ts, 'seed', ts, 'seed', 1],
    ['rol_support', 'SUPPORT', 'Support', 'Read-mostly support staff', true, 'ACTIVE', ts, 'seed', ts, 'seed', 1]
  ]);

  var caps = [
    ['cap_catalog_read', 'catalog.read', 'Read shared catalog data'],
    ['cap_catalog_write', 'catalog.write', 'Manage shared catalog data'],
    ['cap_users_read', 'users.read', 'Read user accounts'],
    ['cap_users_status_write', 'users.status.write', 'Change user account status'],
    ['cap_roles_read', 'roles.read', 'Read roles and assignments'],
    ['cap_roles_manage', 'roles.manage', 'Manage roles and assignments'],
    ['cap_imports_review', 'imports.review', 'Review COR imports'],
    ['cap_documents_read', 'documents.read.support', 'Read documents for support'],
    ['cap_audit_read', 'audit.read', 'Read audit log'],
    ['cap_sysconfig_read', 'system.config.read', 'Read system configuration'],
    ['cap_sysconfig_write', 'system.config.write', 'Write system configuration'],
    ['cap_announcements_write', 'announcements.write', 'Manage announcements']
  ].map(function (c) {
    return [c[0], c[1], c[2], 'ACTIVE', ts, 'seed', ts, 'seed', 1];
  });
  seeded += seedRows(ss, 'Capabilities', caps);

  // A student gets catalog read only. Everything else is operator surface.
  seeded += seedRows(ss, 'Role_Capabilities', [
    ['rc_student_catalog', 'rol_student', 'cap_catalog_read', 'ACTIVE', ts, 'seed', ts, 'seed', 1]
  ]);

  Logger.log('Catalog seed complete. Rows written: ' + seeded);
  try {
    SpreadsheetApp.getUi().alert('Seed complete!\n\nRows written: ' + seeded +
      '\n\nRun the catalog.sync action (or npm run sheets:sync-catalog) to push ' +
      'the academic catalog into the catalog sheets.');
  } catch (e) {
    // No UI available — the log is enough.
  }
  return seeded;
}

/**
 * Append rows to a sheet, skipping any whose primary key already exists.
 * Rows are positional and must match the sheet definition's column order.
 */
function seedRows(ss, sheetName, rows) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('Sheet not found, skipping seed: ' + sheetName);
    return 0;
  }
  if (!rows || !rows.length) return 0;

  var columns = getSheetDefinitions()[sheetName];
  var existing = {};
  if (sheet.getLastRow() > 1) {
    var keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i][0] !== '' && keys[i][0] !== null) existing[String(keys[i][0])] = true;
    }
  }

  var pending = [];
  for (var j = 0; j < rows.length; j++) {
    if (existing[String(rows[j][0])]) continue;
    var padded = rows[j].slice();
    while (padded.length < columns.length) padded.push('');
    pending.push(padded.slice(0, columns.length));
  }
  if (!pending.length) {
    Logger.log('All seed rows already present: ' + sheetName);
    return 0;
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, pending.length, columns.length).setValues(pending);
  Logger.log('Seeded ' + pending.length + ' rows into ' + sheetName);
  return pending.length;
}

// ---------------------------------------------------------------------------
// Sheet access primitives
// ---------------------------------------------------------------------------
// Every sheet is read at most once per execution. Apps Script charges per
// Range call, not per row, so one getDataRange() plus one bulk write per sheet
// is the difference between a 400 ms response and a 20 s timeout.

var _sheetCache = {};

function getSheetData(sheetName) {
  if (_sheetCache[sheetName]) return _sheetCache[sheetName];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    _sheetCache[sheetName] = { sheet: null, header: [], rows: [], index: {} };
    return _sheetCache[sheetName];
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var rows = (lastRow > 1 && lastCol) ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  // PK is always column 1. index maps pk -> zero-based offset into `rows`.
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    var pk = rows[i][0];
    if (pk !== '' && pk !== null && pk !== undefined) index[String(pk)] = i;
  }

  _sheetCache[sheetName] = { sheet: sheet, header: header, rows: rows, index: index };
  return _sheetCache[sheetName];
}

/** Convert a sheet row array into a plain object keyed by header name. */
function rowToObject(header, row) {
  var obj = {};
  for (var i = 0; i < header.length; i++) {
    var key = header[i];
    if (!key) continue;
    var value = row[i];
    if (value === '' || value === null || value === undefined) {
      obj[key] = null;
    } else if (value instanceof Date) {
      obj[key] = value.toISOString();
    } else {
      obj[key] = value;
    }
  }
  return obj;
}

/** Convert an object into a positional row array for the given header. */
function objectToRow(header, obj) {
  var row = [];
  for (var i = 0; i < header.length; i++) {
    var key = header[i];
    var value = key ? obj[key] : null;
    if (value === null || value === undefined) {
      row.push('');
    } else if (typeof value === 'object') {
      row.push(JSON.stringify(value));
    } else {
      // Prevent user-controlled text from becoming a spreadsheet formula.
      row.push(typeof value === 'string' && value.charAt(0) === '=' ? "'" + value : value);
    }
  }
  return row;
}

/** All rows of a sheet as objects, optionally filtered by a column value. */
function readRows(sheetName, filterColumn, filterValue) {
  var data = getSheetData(sheetName);
  if (!data.sheet) return [];
  var colIndex = filterColumn ? data.header.indexOf(filterColumn) : -1;
  var out = [];
  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];
    if (!row[0] && row[0] !== 0) continue;
    if (colIndex >= 0 && String(row[colIndex]) !== String(filterValue)) continue;
    out.push(rowToObject(data.header, row));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch writer
// ---------------------------------------------------------------------------

/**
 * Apply a list of write operations across any number of sheets.
 *
 * Each op is { kind, id, row } for an upsert, or { kind, id, remove: true }
 * for a hard delete. Ops are grouped per sheet so each sheet costs one read,
 * one bulk append and one setValues per changed row.
 *
 * Returns { applied, inserted, updated, removed, skipped }.
 */
function applyOps(ops, actorUserId) {
  var registry = getEntityRegistry();
  var defs = getSheetDefinitions();
  var ts = new Date().toISOString();

  var bySheet = {};
  var skipped = [];

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    var entity = registry[op.kind];
    if (!entity) {
      skipped.push({ kind: op.kind, id: op.id, reason: 'UNKNOWN_KIND' });
      continue;
    }
    if (!op.id) {
      skipped.push({ kind: op.kind, id: null, reason: 'MISSING_ID' });
      continue;
    }
    if (!bySheet[entity.sheet]) bySheet[entity.sheet] = { entity: entity, ops: [] };
    bySheet[entity.sheet].ops.push(op);
  }

  var inserted = 0, updated = 0, removed = 0;
  var sheetNames = Object.keys(bySheet);

  for (var s = 0; s < sheetNames.length; s++) {
    var sheetName = sheetNames[s];
    var group = bySheet[sheetName];
    var data = getSheetData(sheetName);

    if (!data.sheet) {
      for (var k = 0; k < group.ops.length; k++) {
        skipped.push({ kind: group.ops[k].kind, id: group.ops[k].id, reason: 'SHEET_MISSING' });
      }
      continue;
    }

    var header = data.header.length ? data.header : defs[sheetName];
    var pending = [];        // rows to append
    var removeOffsets = [];  // zero-based offsets into data.rows

    for (var o = 0; o < group.ops.length; o++) {
      var op2 = group.ops[o];
      var offset = data.index[String(op2.id)];

      if (op2.remove) {
        if (offset === undefined) {
          skipped.push({ kind: op2.kind, id: op2.id, reason: 'NOT_FOUND' });
        } else {
          removeOffsets.push(offset);
        }
        continue;
      }

      var record = op2.row || {};
      // The primary key column always wins over whatever the payload carried.
      record[group.entity.pk] = op2.id;
      record.updatedAt = record.updatedAt || ts;
      record.updatedBy = actorUserId || 'system';

      if (offset === undefined) {
        record.createdAt = record.createdAt || ts;
        record.createdBy = record.createdBy || actorUserId || 'system';
        record.version = 1;
        pending.push(objectToRow(header, record));
        inserted++;
      } else {
        var current = rowToObject(header, data.rows[offset]);
        record.createdAt = current.createdAt || record.createdAt || ts;
        record.createdBy = current.createdBy || record.createdBy || 'system';
        record.version = (Number(current.version) || 0) + 1;
        var newRow = objectToRow(header, record);
        data.sheet.getRange(offset + 2, 1, 1, newRow.length).setValues([newRow]);
        data.rows[offset] = newRow;
        updated++;
      }
    }

    if (pending.length) {
      var startRow = data.sheet.getLastRow() + 1;
      data.sheet.getRange(startRow, 1, pending.length, header.length).setValues(pending);
      for (var p = 0; p < pending.length; p++) {
        data.index[String(pending[p][0])] = data.rows.length;
        data.rows.push(pending[p]);
      }
    }

    // Delete bottom-up so earlier row numbers stay valid, then drop the cache
    // for this sheet because every offset below the deletion has shifted.
    if (removeOffsets.length) {
      removeOffsets.sort(function (a, b) { return b - a; });
      for (var r = 0; r < removeOffsets.length; r++) {
        data.sheet.deleteRow(removeOffsets[r] + 2);
        removed++;
      }
      delete _sheetCache[sheetName];
    }
  }

  return {
    applied: inserted + updated + removed,
    inserted: inserted,
    updated: updated,
    removed: removed,
    skipped: skipped
  };
}

// ---------------------------------------------------------------------------
// Request authentication
// ---------------------------------------------------------------------------

function getSecret() {
  var secret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET');
  if (!secret) throw new Error('APPS_SCRIPT_SECRET script property is not set');
  return secret;
}

function hmacHex(message, secret) {
  var bytes = Utilities.computeHmacSha256Signature(message, secret);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    // Apps Script signed bytes are -128..127; mask back to 0..255.
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Length-independent comparison so a bad signature leaks no timing signal. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify the envelope and return the parsed command.
 * Throws an ApiError with a stable code on any failure.
 */
function verifyRequest(body) {
  if (!body || typeof body.canonical !== 'string' || typeof body.signature !== 'string') {
    throw apiError('VALIDATION_FAILED', 'Request must carry canonical and signature.');
  }

  var expected = hmacHex(body.canonical, getSecret());
  if (!timingSafeEqual(expected, String(body.signature).toLowerCase())) {
    throw apiError('UNAUTHENTICATED', 'Signature verification failed.');
  }

  var command;
  try {
    command = JSON.parse(body.canonical);
  } catch (e) {
    throw apiError('VALIDATION_FAILED', 'Canonical payload is not valid JSON.');
  }

  var skew = Math.abs(Date.now() - Date.parse(command.timestamp));
  if (!command.timestamp || isNaN(skew) || skew > MAX_CLOCK_SKEW_MS) {
    throw apiError('UNAUTHENTICATED', 'Request timestamp is outside the accepted window.');
  }

  if (!command.nonce) {
    throw apiError('VALIDATION_FAILED', 'Request nonce is required.');
  }
  var nonceLock = LockService.getScriptLock();
  if (!nonceLock.tryLock(LOCK_TIMEOUT_MS)) throw apiError('RATE_LIMITED', 'Database busy.');
  try {
    var cache = CacheService.getScriptCache();
    var nonceKey = 'nonce_' + command.nonce;
    if (cache.get(nonceKey)) throw apiError('UNAUTHENTICATED', 'Request nonce has already been used.');
    cache.put(nonceKey, '1', NONCE_TTL_SECONDS);
  } finally { nonceLock.releaseLock(); }

  if (!command.action) {
    throw apiError('VALIDATION_FAILED', 'Request action is required.');
  }
  command.actor = command.actor || {};
  command.payload = command.payload || {};
  return command;
}

function apiError(code, message, fields) {
  var err = new Error(message);
  err.apiCode = code;
  if (fields) err.apiFields = fields;
  return err;
}

var RETRYABLE_CODES = { RATE_LIMITED: true, INTERNAL_ERROR: true };

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doPost(e) {
  _sheetCache = {};
  var requestId = null;

  try {
    if (e && e.postData && e.postData.contents && e.postData.contents.length > 2000000) throw apiError('PAYLOAD_TOO_LARGE', 'Request too large.');
    if (!e || !e.postData || !e.postData.contents) {
      throw apiError('VALIDATION_FAILED', 'Empty request body.');
    }
    var command = verifyRequest(JSON.parse(e.postData.contents));
    requestId = command.requestId || null;

    var actor = resolveActor(command.actor);
    var result = dispatch(command.action, actor, command.payload);
    return jsonResponse({ ok: true, data: result, error: null, meta: meta(requestId) });
  } catch (err) {
    var code = err.apiCode || 'INTERNAL_ERROR';
    // Unexpected failures must not leak stack traces or sheet internals.
    var message = err.apiCode ? err.message : 'An unexpected error occurred.';
    if (!err.apiCode) Logger.log('UNHANDLED: ' + err + ' ' + (err.stack || ''));
    return jsonResponse({
      ok: false,
      data: null,
      error: {
        code: code,
        message: message,
        fields: err.apiFields || null,
        retryable: !!RETRYABLE_CODES[code]
      },
      meta: meta(requestId)
    });
  }
}

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : null;
  if (action === 'health') {
    var defs = getSheetDefinitions();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var present = 0;
    var names = Object.keys(defs);
    for (var i = 0; i < names.length; i++) {
      if (ss.getSheetByName(names[i])) present++;
    }
    return jsonResponse({
      ok: true,
      data: {
        status: present === names.length ? 'healthy' : 'incomplete',
        sheetsExpected: names.length,
        sheetsPresent: present,
        secretConfigured: !!PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET')
      },
      error: null,
      meta: meta(null)
    });
  }
  return jsonResponse({ ok: true, data: { message: 'QCU Schedule API' }, error: null, meta: meta(null) });
}

function meta(requestId) {
  return { requestId: requestId, apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION };
}

function jsonResponse(payload) {
  // A web app always answers 200; the ok flag carries success or failure.
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Actor resolution and dispatch
// ---------------------------------------------------------------------------

/**
 * Resolve the caller into { userId, googleSub, email, accountStatus, isNew }.
 *
 * userId is derived from googleSub with the same rule the Cloudflare repo uses
 * (Users.resolveId), so an id minted on either side always agrees. A row in
 * Users wins over the derived value in case a user was created another way.
 */
function resolveActor(actor) {
  var googleSub = actor && actor.googleSub ? String(actor.googleSub) : '';
  if (!googleSub) throw apiError('UNAUTHENTICATED', 'Actor googleSub is required.');

  var rows = readRows('Users');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].googleSub) === googleSub) {
      if (rows[i].accountStatus === 'CLOSED' || rows[i].accountStatus === 'SUSPENDED') {
        throw apiError('FORBIDDEN', 'This account is not active.');
      }
      if (Number(rows[i].sessionsRevokedAt) && Number(actor.issuedAt || 0) <= Number(rows[i].sessionsRevokedAt)) throw apiError('UNAUTHENTICATED', 'Please sign in again.');
      return {
        userId: String(rows[i].userId),
        googleSub: googleSub,
        email: rows[i].email || (actor.email || ''),
        accountStatus: rows[i].accountStatus || 'ACTIVE',
        emailVerified: actor.emailVerified === true,
        issuedAt: Number(actor.issuedAt) || 0,
        isNew: false
      };
    }
  }

  return {
    userId: 'user_' + googleSub,
    googleSub: googleSub,
    email: (actor && actor.email) || '',
    accountStatus: 'ACTIVE',
    isNew: true
  };
}

function dispatch(action, actor, payload) {
  switch (action) {
    // Batch pair used by the Cloudflare repository layer.
    case 'auth.read': return { user: adminUserProjection(readRows('Users', 'googleSub', actor.googleSub)[0] || {}), isNew: actor.isNew };
    case 'admin.access': requireAdministrator(actor); return { authorized: true };
    case 'admin.users.list': requireAdministrator(actor); return adminListUsers(payload);
    case 'admin.user.read': requireAdministrator(actor); return adminReadUser(actor, payload);
    case 'admin.user.update': requireAdministrator(actor); return adminUpdateUser(actor, payload);
    case 'snapshot.read':   return handleSnapshotRead(actor, payload);
    case 'batch.write':     return handleBatchWrite(actor, payload);

    // Fine-grained actions from DATABASE.md section 15.
    case 'bootstrap.read':  return handleBootstrapRead(actor, payload);
    case 'profile.read':    return handleProfileRead(actor, payload);
    case 'catalog.list':    return handleCatalogList(actor, payload);
    case 'catalog.sync':    return handleCatalogSync(actor, payload);
    case 'task.list':       return { rows: readOwned('tasks', actor.userId) };
    case 'note.list':       return { rows: readOwned('notes', actor.userId) };
    case 'schedule.active.read': return handleScheduleActiveRead(actor, payload);
    case 'audit.append':
      (payload.events || []).forEach(function(ev) {
        if (String(ev.action).indexOf('admin.') === 0) throw apiError('FORBIDDEN', 'Reserved audit action.');
        ev.actorType = 'USER';
      });
      return handleAuditAppend(actor, payload);

    default:
      throw apiError('NOT_FOUND', 'Unknown action: ' + action);
  }
}

/** Read every row of a user-owned entity belonging to one user. */
function readOwned(kind, userId) {
  var entity = getEntityRegistry()[kind];
  if (!entity) throw apiError('NOT_FOUND', 'Unknown entity kind: ' + kind);
  if (!entity.owner) return readRows(entity.sheet);
  return readRows(entity.sheet, entity.owner, userId);
}

// ---------------------------------------------------------------------------
// snapshot.read / batch.write
// ---------------------------------------------------------------------------

/**
 * Return every row this user owns, across all user-owned entities, in one
 * execution. The Cloudflare repository hydrates its in-memory maps from this
 * so a request can serve dozens of synchronous reads without further calls.
 */
function handleSnapshotRead(actor, payload) {
  var registry = getEntityRegistry();
  var kinds = payload && payload.kinds && payload.kinds.length
    ? payload.kinds
    : Object.keys(registry);

  var out = {};
  for (var i = 0; i < kinds.length; i++) {
    var kind = kinds[i];
    var entity = registry[kind];
    if (!entity) continue;

    if (kind === 'users') {
      // Only ever the caller's own row.
      var users = readRows(entity.sheet, 'googleSub', actor.googleSub);
      out.users = users;
      continue;
    }
    out[kind] = readRows(entity.sheet, entity.owner, actor.userId);
  }

  return { userId: actor.userId, isNew: actor.isNew, entities: out };
}

/**
 * Apply a batch of upserts and deletes for the calling user.
 *
 * Ownership is enforced here, not trusted from the payload: the owner column is
 * overwritten with the resolved actor, and an op targeting a row owned by
 * somebody else is rejected outright.
 */
function handleBatchWrite(actor, payload) {
  var ops = (payload && payload.ops) || [];
  if (!ops.length) return { applied: 0, inserted: 0, updated: 0, removed: 0, skipped: [] };
  if (ops.length > 500) {
    throw apiError('PAYLOAD_TOO_LARGE', 'A batch may contain at most 500 operations.');
  }

  var registry = getEntityRegistry();
  var safeOps = [];

  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    var entity = registry[op.kind];
    if (!entity) throw apiError('VALIDATION_FAILED', 'Unknown entity kind: ' + op.kind);

    if (entity.owner && op.row) {
      op.row[entity.owner] = actor.userId;
    }
    if (op.kind === 'users') {
      // A caller may only ever write their own user row.
      if (op.row) {
        op.row.googleSub = actor.googleSub;
        op.row.userId = actor.userId;
      }
      op.id = actor.userId;
    }
    safeOps.push(op);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw apiError('RATE_LIMITED', 'The database is busy. Please retry.');
  }
  try {
    // Re-read inside the lock so ownership checks see committed state.
    _sheetCache = {};
    resolveActor(actor); // Recheck account status inside the write lock.
    assertOwnership(safeOps, actor.userId);
    protectUserFields(safeOps, actor);
    return applyOps(safeOps, actor.userId);
  } finally {
    lock.releaseLock();
  }
}

/** Reject any op whose existing row belongs to a different user. */
function assertOwnership(ops, actorUserId) {
  var registry = getEntityRegistry();
  for (var i = 0; i < ops.length; i++) {
    var entity = registry[ops[i].kind];
    if (!entity || !entity.owner) continue;

    var data = getSheetData(entity.sheet);
    if (!data.sheet) continue;
    var offset = data.index[String(ops[i].id)];
    if (offset === undefined) continue;

    var ownerCol = data.header.indexOf(entity.owner);
    if (ownerCol < 0) continue;
    var existingOwner = data.rows[offset][ownerCol];
    if (existingOwner && String(existingOwner) !== String(actorUserId)) {
      throw apiError('FORBIDDEN', 'You do not have access to ' + ops[i].kind + ' ' + ops[i].id + '.');
    }
  }
}

// ---------------------------------------------------------------------------
// Remaining actions
// ---------------------------------------------------------------------------

function handleBootstrapRead(actor, payload) {
  var users = readRows('Users', 'googleSub', actor.googleSub);
  var user = users.length ? users[0] : null;
  var profiles = readOwned('profiles', actor.userId);
  var enrollments = readOwned('enrollments', actor.userId);
  var schedules = readOwned('schedules', actor.userId);

  var activeEnrollment = null;
  for (var i = 0; i < enrollments.length; i++) {
    if (enrollments[i].status === 'ACTIVE') { activeEnrollment = enrollments[i]; break; }
  }
  var activeSchedule = null;
  for (var j = 0; j < schedules.length; j++) {
    if (schedules[j].status === 'ACTIVE') { activeSchedule = schedules[j]; break; }
  }

  return {
    user: user,
    profile: profiles.length ? profiles[0] : null,
    onboardingState: user ? (user.onboardingState || 'AWAITING_COR') : 'AWAITING_COR',
    activeEnrollment: activeEnrollment,
    activeSchedule: activeSchedule
  };
}

function handleProfileRead(actor, payload) {
  var profiles = readOwned('profiles', actor.userId);
  return { profile: profiles.length ? profiles[0] : null };
}

var CATALOG_SHEETS = {
  campuses: 'Campuses',
  departments: 'Departments',
  programs: 'Programs',
  offerings: 'Program_Offerings',
  terms: 'Academic_Terms',
  sections: 'Sections',
  subjects: 'Subjects',
  programSubjects: 'Program_Subjects',
  buildings: 'Buildings',
  rooms: 'Rooms'
};

function handleCatalogList(actor, payload) {
  var entity = (payload && payload.entity) || 'campuses';
  var sheetName = CATALOG_SHEETS[entity];
  if (!sheetName) throw apiError('NOT_FOUND', 'Unknown catalog entity: ' + entity);

  var rows = readRows(sheetName);
  if (!payload || payload.includeInactive !== true) {
    rows = rows.filter(function (r) { return r.status === 'ACTIVE'; });
  }

  var limit = Math.min(Number(payload && payload.limit) || 500, 1000);
  var offset = Number(payload && payload.offset) || 0;
  var page = rows.slice(offset, offset + limit);

  return {
    rows: page,
    total: rows.length,
    nextOffset: (offset + page.length < rows.length) ? offset + page.length : null
  };
}

/**
 * Overwrite the catalog sheets from the canonical academic catalog pushed by
 * Cloudflare. Upserts by primary key; rows absent from the payload are marked
 * INACTIVE rather than deleted, so historical foreign keys keep resolving.
 */
function handleCatalogSync(actor, payload) {
  var operator = PropertiesService.getScriptProperties().getProperty('CATALOG_SYNC_GOOGLE_SUB');
  if (!operator || actor.googleSub !== operator) throw apiError('FORBIDDEN', 'Catalog operator required.');
  var catalog = (payload && payload.catalog) || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw apiError('RATE_LIMITED', 'The database is busy. Please retry.');
  }

  try {
    _sheetCache = {};
    var ts = new Date().toISOString();
    var result = {};
    var keys = Object.keys(CATALOG_SHEETS);

    for (var i = 0; i < keys.length; i++) {
      var entity = keys[i];
      var incoming = catalog[entity];
      if (!incoming || !incoming.length) continue;

      var sheetName = CATALOG_SHEETS[entity];
      var data = getSheetData(sheetName);
      if (!data.sheet) continue;
      var header = data.header.length ? data.header : getSheetDefinitions()[sheetName];

      var seen = {};
      var pending = [];
      for (var r = 0; r < incoming.length; r++) {
        var record = incoming[r];
        var pk = String(record[header[0]] || '');
        if (!pk) continue;
        seen[pk] = true;

        record.status = record.status || 'ACTIVE';
        record.updatedAt = ts;
        record.updatedBy = 'catalog.sync';

        var offset = data.index[pk];
        if (offset === undefined) {
          record.createdAt = record.createdAt || ts;
          record.createdBy = 'catalog.sync';
          record.version = 1;
          pending.push(objectToRow(header, record));
        } else {
          var current = rowToObject(header, data.rows[offset]);
          record.createdAt = current.createdAt || ts;
          record.createdBy = current.createdBy || 'catalog.sync';
          record.version = (Number(current.version) || 0) + 1;
          var newRow = objectToRow(header, record);
          data.sheet.getRange(offset + 2, 1, 1, newRow.length).setValues([newRow]);
          data.rows[offset] = newRow;
        }
      }

      if (pending.length) {
        data.sheet.getRange(data.sheet.getLastRow() + 1, 1, pending.length, header.length)
          .setValues(pending);
      }

      // Retire rows the canonical catalog no longer lists.
      var statusCol = header.indexOf('status');
      var retired = 0;
      if (statusCol >= 0) {
        for (var x = 0; x < data.rows.length; x++) {
          var existingPk = String(data.rows[x][0] || '');
          if (!existingPk || seen[existingPk]) continue;
          if (String(data.rows[x][statusCol]) === 'INACTIVE') continue;
          data.sheet.getRange(x + 2, statusCol + 1).setValue('INACTIVE');
          retired++;
        }
      }

      result[entity] = { received: incoming.length, inserted: pending.length, retired: retired };
      delete _sheetCache[sheetName];
    }

    return { synced: result, catalogVersion: catalog.version || null };
  } finally {
    lock.releaseLock();
  }
}

function handleScheduleActiveRead(actor, payload) {
  var schedules = readOwned('schedules', actor.userId);
  var active = null;
  for (var i = 0; i < schedules.length; i++) {
    if (schedules[i].status === 'ACTIVE') { active = schedules[i]; break; }
  }
  if (!active) return { schedule: null, entries: [], subjects: [] };

  var entries = readOwned('scheduleEntries', actor.userId).filter(function (e) {
    return e.scheduleId === active.scheduleId && e.status === 'ACTIVE';
  });
  return {
    schedule: active,
    entries: entries,
    subjects: readOwned('enrollmentSubjects', actor.userId)
  };
}

/** Append-only audit trail. Callers may never update or delete a row. */
function handleAuditAppend(actor, payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Audit_Log');
  if (!sheet) return { recorded: false };

  var events = (payload && payload.events) || [];
  if (!events.length) return { recorded: false, count: 0 };

  var header = getSheetDefinitions()['Audit_Log'];
  var rows = events.slice(0, 200).map(function (ev) {
    ev.auditEventId = ev.auditEventId || 'aud_' + Utilities.getUuid();
    ev.occurredAt = ev.occurredAt || new Date().toISOString();
    ev.actorType = ev.actorType || 'USER';
    ev.actorUserId = actor.userId;
    return objectToRow(header, ev);
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  return { recorded: true, count: rows.length };
}

// Administrative API. All actions remain behind the signed server-to-server envelope.
function requireAdministrator(actor) {
  var pinned = PropertiesService.getScriptProperties().getProperty('ADMIN_GOOGLE_SUB');
  pinned = String(pinned || '').trim();
  if ((pinned && actor.googleSub !== pinned) || !actor.googleSub || actor.emailVerified !== true ||
      String(actor.email).toLowerCase() !== 'myscheduleqcu@gmail.com' || actor.isNew ||
      !actor.issuedAt || Date.now() - actor.issuedAt > 3600000) {
    throw apiError('FORBIDDEN', 'Administrator sign-in required.');
  }
}
function protectUserFields(ops, actor) {
  var current = readRows('Users', 'googleSub', actor.googleSub)[0];
  ops.forEach(function(op) {
    if (op.kind !== 'users') return;
    if (op.remove) throw apiError('FORBIDDEN', 'Use the administrator account closure workflow.');
    ['accountStatus', 'suspendedReason', 'closedAt', 'sessionsRevokedAt'].forEach(function(key) {
      op.row[key] = current ? current[key] : (key === 'accountStatus' ? 'ACTIVE' : null);
    });
    // No role, status or revocation authority may be smuggled through extraJson.
    var extra = {};
    try { extra = JSON.parse(op.row.extraJson || '{}'); } catch (_) {}
    ['role', 'accountStatus', 'sessionsRevokedAt', 'emailVerified', 'googleSub', 'email', 'userId'].forEach(function(key) { delete extra[key]; });
    op.row.extraJson = JSON.stringify(extra);
    op.row.email = actor.email;
  });
}
function adminUserProjection(row) {
  var out = {};
  ['userId','displayName','email','accountStatus','onboardingState','createdAt','lastLoginAt','version','suspendedReason'].forEach(function(k) { out[k] = row[k] || null; });
  return out;
}
function adminTarget(id) {
  if (typeof id !== 'string' || !id || id.length > 160) throw apiError('VALIDATION_FAILED', 'Invalid user.');
  var row = readRows('Users', 'userId', id)[0];
  if (!row) throw apiError('NOT_FOUND', 'User not found.');
  return row;
}
function adminListUsers(payload) {
  if (Object.keys(payload).some(function(k) { return ['q','status','from','to','page','campus','program','section'].indexOf(k) < 0; }) ||
      (payload.status && ['ACTIVE','SUSPENDED','CLOSED'].indexOf(payload.status) < 0)) throw apiError('VALIDATION_FAILED', 'Invalid filters.');
  var rows = readRows('Users');
  var today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  var counts = { total: rows.length, today: 0, week: 0, active: 0, suspended: 0 };
  rows.forEach(function(r) {
    var time = Date.parse(r.createdAt);
    if (isFinite(time) && new Date(time + 8 * 3600000).toISOString().slice(0,10) === today) counts.today++;
    if (time >= Date.now() - 7 * 86400000) counts.week++;
    if (r.onboardingState === 'ACTIVE' && r.accountStatus === 'ACTIVE') counts.active++;
    if (r.accountStatus === 'SUSPENDED') counts.suspended++;
  });
  var query = String(payload.q || '').toLowerCase().slice(0,100);
  var enrollments = readRows('Enrollments');
  var offerings = readRows('Program_Offerings');
  enrollments.forEach(function(e) {
    var extra = {}; try { extra = JSON.parse(e.extraJson || '{}'); } catch (_) {}
    var offering = offerings.filter(function(o) { return o.offeringId === e.offeringId; })[0] || {};
    e.programId = offering.programId || extra.programId;
    e.campusId = offering.campusId || extra.campusId;
  });
  var filters = {
    campuses: readRows('Campuses').map(function(r) { return { value: r.campusId, label: r.name || r.campusCode || r.campusId }; }),
    programs: readRows('Programs').map(function(r) { return { value: r.programId, label: r.name || r.programCode || r.programId }; }),
    sections: []
  };
  enrollments.forEach(function(e) {
    var value = e.sectionId || e.sectionLabelSnapshot;
    if (value && !filters.sections.some(function(s) { return s.value === value; })) filters.sections.push({ value: value, label: e.sectionLabelSnapshot || value });
  });
  rows = rows.filter(function(r) {
    return (!query || [r.displayName,r.email,r.userId].join(' ').toLowerCase().indexOf(query) >= 0) &&
      (!payload.status || r.accountStatus === payload.status) &&
      (!payload.from || String(r.createdAt || '').slice(0,10) >= payload.from) &&
      (!payload.to || String(r.createdAt || '').slice(0,10) <= payload.to) &&
      (!(payload.section || payload.program || payload.campus) || enrollments.some(function(e) { return e.ownerUserId === r.userId && (!payload.section || (e.sectionId || e.sectionLabelSnapshot) === payload.section) && (!payload.program || e.programId === payload.program) && (!payload.campus || e.campusId === payload.campus); }));
  });
  rows.sort(function(a,b) { return String(b.createdAt).localeCompare(String(a.createdAt)) || String(a.userId).localeCompare(String(b.userId)); });
  var page = Math.max(1, Math.floor(Number(payload.page) || 1));
  var audit = readRows('Audit_Log').filter(function(e) { return String(e.action).indexOf('admin.') === 0; }).slice(-15).reverse();
  return { filters: filters, counts: counts, total: rows.length, page: page, pageSize: 25, users: rows.slice((page-1)*25,page*25).map(adminUserProjection), audit: audit.map(function(e) { return { occurredAt: e.occurredAt, action: e.action, targetId: e.targetId, result: e.result }; }), refreshedAt: new Date().toISOString() };
}
function adminDependencies(userId) {
  var result = {};
  var defs = getSheetDefinitions();
  Object.keys(defs).forEach(function(name) {
    if (name === 'Users') return;
    var owner = defs[name].indexOf('ownerUserId') >= 0 ? 'ownerUserId' : defs[name].indexOf('userId') >= 0 ? 'userId' : null;
    if (owner) result[name] = readRows(name, owner, userId).length;
  });
  return result;
}
function adminReadUser(actor, payload) {
  var row = adminTarget(payload.userId);
  function projection(name, keys) {
    return readRows(name, 'ownerUserId', row.userId).map(function(r) {
      var out = {}; keys.forEach(function(k) { out[k] = r[k]; }); return out;
    });
  }
  var profiles = readRows('Student_Profiles', 'userId', row.userId).map(function(r) {
    return { studentNumber: r.studentNumber, firstName: r.firstName, lastName: r.lastName, verificationStatus: r.verificationStatus };
  });
  return { user: adminUserProjection(row), protected: row.googleSub === actor.googleSub,
    profiles: profiles, dependencies: adminDependencies(row.userId),
    enrollments: projection('Enrollments', ['termId','offeringId','sectionId','sectionLabelSnapshot','yearLevel','status']),
    schedule: projection('Schedule_Entries', ['dayOfWeek','startTime','endTime','subjectId','locationText','status']),
    cor: projection('COR_Records', ['corRecordId','status','createdAt','confirmedAt','failureCode']) };
}
function adminAudit(actor, payload, result) {
  var written = handleAuditAppend(actor, { events: [{ action: 'admin.' + payload.operation, targetType: 'USER', targetId: payload.userId, result: result, reason: payload.reason, requestId: payload.mutationId, actorType: 'ADMINISTRATOR' }] });
  if (!written.recorded) throw apiError('INTERNAL_ERROR', 'Audit store unavailable.');
}
function adminUpdateUser(actor, payload) {
  if (Object.keys(payload).some(function(k) { return ['operation','userId','version','reason','mutationId','confirm'].indexOf(k) < 0; }) ||
      ['suspend','reactivate','close','purge'].indexOf(payload.operation) < 0 ||
      typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 500 ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(payload.mutationId || '')) throw apiError('VALIDATION_FAILED', 'Action, reason and mutation ID are required.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) throw apiError('RATE_LIMITED', 'Database busy. Please retry.');
  try {
    _sheetCache = {};
    requireAdministrator(resolveActor(actor));
    var row = adminTarget(payload.userId);
    if (row.googleSub === actor.googleSub) throw apiError('FORBIDDEN', 'You cannot modify your own administrator account.');
    var events = readRows('Audit_Log');
    var previous = events.filter(function(e) { return e.requestId === payload.mutationId && e.actorUserId === actor.userId; });
    if (previous.some(function(e) { return e.targetId !== payload.userId || e.action !== 'admin.' + payload.operation; })) throw apiError('CONFLICT', 'Mutation ID already used.');
    if (previous.some(function(e) { return e.result === 'SUCCESS'; })) return { ok: true, replayed: true };
    if (Number(row.version) !== Number(payload.version)) throw apiError('CONFLICT', 'The account changed. Refresh its details before retrying.');
    var recent = events.filter(function(e) { return e.actorUserId === actor.userId && e.result === 'STARTED' && Date.parse(e.occurredAt) > Date.now()-60000; });
    if (recent.length >= 20) throw apiError('RATE_LIMITED', 'Too many account changes. Wait a minute.');
    if (payload.operation === 'purge' && (row.accountStatus !== 'CLOSED' || payload.confirm !== row.userId)) throw apiError('VALIDATION_FAILED', 'Close the account first and confirm its user ID.');
    if (payload.operation === 'reactivate' && row.accountStatus !== 'SUSPENDED') throw apiError('VALIDATION_FAILED', 'Only suspended accounts can be reactivated.');
    if (payload.operation === 'suspend' && row.accountStatus === 'CLOSED') throw apiError('VALIDATION_FAILED', 'Closed accounts cannot be suspended.');
    adminAudit(actor, payload, 'STARTED');
    if (payload.operation === 'purge') {
      // Trash referenced files before removing their metadata; failures leave the closed account retryable.
      readRows('Document_Assets', 'ownerUserId', row.userId).forEach(function(asset) {
        if (asset.driveFileId) DriveApp.getFileById(String(asset.driveFileId)).setTrashed(true);
      });
      var defs = getSheetDefinitions();
      Object.keys(adminDependencies(row.userId)).forEach(function(name) {
        var data = getSheetData(name);
        var owner = defs[name].indexOf('ownerUserId') >= 0 ? 'ownerUserId' : 'userId';
        for (var i = data.rows.length-1; i >= 0; i--) {
          if (String(rowToObject(data.header,data.rows[i])[owner]) === row.userId) data.sheet.deleteRow(i+2);
        }
        delete _sheetCache[name];
      });
      // Keep a minimal closed identity tombstone to prevent silent re-registration.
      row = { userId: row.userId, googleSub: row.googleSub, accountStatus: 'CLOSED', closedAt: row.closedAt, createdAt: row.createdAt, sessionsRevokedAt: Date.now() };
    } else {
      row.accountStatus = { suspend: 'SUSPENDED', reactivate: 'ACTIVE', close: 'CLOSED' }[payload.operation];
      row.suspendedReason = payload.reason.trim();
      row.sessionsRevokedAt = Date.now();
      if (payload.operation === 'close') row.closedAt = new Date().toISOString();
    }
    row.updatedAt = new Date().toISOString();
    var result = applyOps([{ kind: 'users', id: row.userId, row: row }], actor.userId);
    if (result.skipped.length) throw apiError('INTERNAL_ERROR', 'Account update failed.');
    adminAudit(actor, payload, 'SUCCESS');
    return { ok: true };
  } finally { lock.releaseLock(); }
}
