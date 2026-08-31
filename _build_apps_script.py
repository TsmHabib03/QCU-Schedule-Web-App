#!/usr/bin/env python3
"""Generate Apps Script setup code for QCU Schedule Database."""

SHEETS = {
    "Users": [
        "userId", "googleSub", "email", "emailVerified", "displayName",
        "avatarUrl", "accountStatus", "onboardingState", "lastLoginAt",
        "suspendedReason", "closedAt",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Student_Profiles": [
        "profileId", "userId", "studentNumber", "firstName", "middleName",
        "lastName", "suffix", "preferredName", "verificationStatus",
        "sourceCorRecordId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Roles": [
        "roleId", "roleKey", "displayName", "description", "isSystemRole", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Capabilities": [
        "capabilityId", "capabilityKey", "description", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Role_Capabilities": [
        "roleCapabilityId", "roleId", "capabilityId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Role_Assignments": [
        "roleAssignmentId", "userId", "roleId", "scopeType", "scopeId", "status",
        "grantedBy", "grantedAt", "expiresAt", "revokedAt", "revokedBy",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Campuses": [
        "campusId", "campusCode", "name", "shortName", "timeZone",
        "address", "latitude", "longitude", "logoAssetKey", "mapConfigKey", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Departments": [
        "departmentId", "departmentCode", "name", "unitType", "shortName",
        "displayAbbreviation", "logoAssetKey", "parentDepartmentId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Programs": [
        "programId", "departmentId", "programCode", "name", "degreeLevel",
        "shortName", "description", "logoAssetKey", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Program_Offerings": [
        "offeringId", "programId", "campusId",
        "effectiveFromTermId", "effectiveToTermId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Academic_Terms": [
        "termId", "academicYearStart", "academicYearLabel", "termCode", "name",
        "startsOn", "endsOn", "enrollmentOpensOn", "enrollmentClosesOn", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Sections": [
        "sectionId", "offeringId", "termId", "sectionCode", "yearLevel",
        "displayName", "adviserName", "capacity", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Subjects": [
        "subjectId", "subjectCode", "title", "description", "defaultUnits",
        "departmentId", "colorKey", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Program_Subjects": [
        "programSubjectId", "programId", "subjectId", "curriculumCode",
        "recommendedYearLevel", "recommendedTermCode", "unitsOverride",
        "effectiveFromTermId", "effectiveToTermId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Enrollments": [
        "enrollmentId", "ownerUserId", "termId", "offeringId", "sectionId",
        "sectionLabelSnapshot", "yearLevel", "studentStatus", "dateEnrolled",
        "adviserName", "sourceType", "sourceCorRecordId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Enrollment_Subjects": [
        "enrollmentSubjectId", "enrollmentId", "ownerUserId", "subjectId",
        "subjectCodeSnapshot", "subjectTitleSnapshot", "units", "classSection",
        "instructorName", "sourceType", "sourceCorDraftSubjectId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Schedules": [
        "scheduleId", "enrollmentId", "ownerUserId", "revisionNumber", "name",
        "sourceType", "sourceCorRecordId", "status", "activatedAt", "archivedAt",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Schedule_Entries": [
        "scheduleEntryId", "scheduleId", "ownerUserId", "enrollmentSubjectId",
        "dayOfWeek", "startTime", "endTime", "modality", "buildingId", "roomId",
        "locationText", "effectiveFrom", "effectiveTo",
        "sourceCorDraftMeetingId", "originType", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "COR_Records": [
        "corRecordId", "ownerUserId", "originalDocumentId",
        "rawArtifactDocumentId", "contentHash", "status", "providerKey",
        "providerJobId", "attemptCount", "nextAttemptAt", "leaseOwner",
        "leaseExpiresAt", "confidenceSummary", "failureCode", "failureMessage",
        "draftVersion", "confirmedAt", "committedEnrollmentId",
        "committedScheduleId", "commitMutationId", "completedAt",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "COR_Extracted_Fields": [
        "corFieldId", "corRecordId", "ownerUserId", "fieldKey", "sourceText",
        "normalizedValue", "reviewedValue", "resolvedEntityType",
        "resolvedEntityId", "confidence", "reviewStatus", "pageNumber",
        "sourceRegion",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "COR_Draft_Subjects": [
        "corDraftSubjectId", "corRecordId", "ownerUserId", "lineNumber",
        "sourceLineText", "sourceSubjectCode", "sourceSubjectTitle",
        "sourceUnits", "reviewedSubjectCode", "reviewedSubjectTitle",
        "reviewedUnits", "subjectId", "classSection", "instructorName",
        "confidenceCode", "confidenceTitle", "confidenceUnits", "pageNumber",
        "reviewStatus",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "COR_Draft_Meetings": [
        "corDraftMeetingId", "corDraftSubjectId", "ownerUserId",
        "sequenceNumber", "sourceScheduleText", "sourceDay", "sourceStartTime",
        "sourceEndTime", "sourceBuilding", "sourceRoom",
        "dayOfWeek", "startTime", "endTime", "modality", "buildingId", "roomId",
        "locationText", "confidenceDay", "confidenceTime", "confidenceLocation",
        "reviewStatus",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Document_Assets": [
        "documentId", "ownerUserId", "corRecordId", "assetType", "driveFileId",
        "originalFilename", "mimeType", "sizeBytes", "contentHash",
        "storageStatus", "retentionUntil", "deletedAt", "deletionFailureCode",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Buildings": [
        "buildingId", "buildingCode", "name", "shortName", "campusId",
        "description", "imageAssetKey", "latitude", "longitude", "floorCount",
        "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Rooms": [
        "roomId", "roomCode", "name", "buildingId", "floorLabel", "capacity",
        "roomType", "description", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Announcements": [
        "announcementId", "title", "body", "audienceType", "audienceId",
        "publishAt", "expiresAt", "priority", "sourceUrl", "announcementStatus",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Tasks": [
        "taskId", "ownerUserId", "title", "description", "enrollmentSubjectId",
        "priority", "dueAt", "completedAt", "taskStatus", "clientMutationId",
        "deletedAt",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Notes": [
        "noteId", "ownerUserId", "title", "body", "enrollmentSubjectId",
        "noteStatus", "clientMutationId", "deletedAt",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "User_Settings": [
        "userSettingId", "ownerUserId", "settingKey", "valueType", "value",
        "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "System_Settings": [
        "systemSettingId", "settingKey", "valueType", "value", "visibility",
        "description", "scopeType", "scopeId", "status",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Audit_Log": [
        "auditEventId", "occurredAt", "requestId", "actorType", "actorUserId",
        "action", "targetType", "targetId", "result", "scopeType", "scopeId",
        "summary", "reason", "ipHash", "userAgentHash", "metadata",
        "retentionUntil"
    ],
    "Mutation_Receipts": [
        "mutationReceiptId", "actorUserId", "clientMutationId", "action",
        "requestHash", "resultStatus", "targetType", "targetId",
        "responseReference", "completedAt", "errorCode", "expiresAt",
        "createdAt", "createdBy", "updatedAt", "updatedBy", "version"
    ],
    "Schema_Migrations": [
        "migrationId", "schemaVersion", "migrationKey", "description",
        "appliedAt", "appliedBy", "checksum", "backupReference", "notes", "status"
    ],
}

# Seed data for initial catalog
SEED_DATA = {
    "Campuses": [
        ["cam_sb", "QCU-SB", "QCU San Bartolome Campus", "San Bartolome", "Asia/Manila", "", "", "", "", "", "ACTIVE"],
    ],
    "Departments": [
        ["dep_ccs", "CCS", "College of Computer Studies", "COLLEGE", "CCS", "CCS", "college-ccs", "", "ACTIVE"],
        ["dep_cbea", "CBEA", "College of Business Education and Arts", "COLLEGE", "CBEA", "CBEA", "college-cbea", "", "ACTIVE"],
        ["dep_coed", "COED", "College of Education", "COLLEGE", "COED", "COED", "college-coed", "", "ACTIVE"],
        ["dep_con", "CON", "College of Nursing", "COLLEGE", "CON", "CON", "college-con", "", "ACTIVE"],
        ["dep_coe", "COE", "College of Engineering", "COLLEGE", "COE", "COE", "college-coe", "", "ACTIVE"],
    ],
    "Programs": [
        ["prg_bscs", "dep_ccs", "BSCS", "Bachelor of Science in Computer Science", "BACHELOR", "BSCS", "", "", "ACTIVE"],
        ["prg_bsit", "dep_ccs", "BSIT", "Bachelor of Science in Information Technology", "BACHELOR", "BSIT", "", "", "ACTIVE"],
        ["prg_bsba", "dep_cbea", "BSBA", "Bachelor of Science in Business Administration", "BACHELOR", "BSBA", "", "", "ACTIVE"],
        ["prg_beed", "dep_coed", "BEED", "Bachelor of Elementary Education", "BACHELOR", "BEED", "", "", "ACTIVE"],
        ["prg_bsed", "dep_coed", "BSED", "Bachelor of Secondary Education", "BACHELOR", "BSED", "", "", "ACTIVE"],
        ["prg_bsn", "dep_con", "BSN", "Bachelor of Science in Nursing", "BACHELOR", "BSN", "", "", "ACTIVE"],
        ["prg_bsee", "dep_coe", "BSEE", "Bachelor of Science in Electrical Engineering", "BACHELOR", "BSEE", "", "", "ACTIVE"],
        ["prg_ce", "dep_coe", "CE", "Bachelor of Science in Civil Engineering", "BACHELOR", "CE", "", "", "ACTIVE"],
    ],
    "Academic_Terms": [
        ["trm_2026_1", 2026, "2026-2027", "FIRST_SEMESTER", "First Semester AY 2026-2027", "2026-08-01", "2026-12-20", "2026-06-01", "2026-07-31", "ACTIVE"],
    ],
    "Roles": [
        ["rol_student", "STUDENT", "Student", "Default student role", "true", "ACTIVE"],
        ["rol_admin", "ADMINISTRATOR", "Administrator", "Platform administrator", "true", "ACTIVE"],
    ],
    "Capabilities": [
        ["cap_catalog_read", "catalog.read", "Read shared catalog data", "ACTIVE"],
        ["cap_catalog_write", "catalog.write", "Manage shared catalog data", "ACTIVE"],
        ["cap_users_read", "users.read", "Read user accounts", "ACTIVE"],
        ["cap_users_status_write", "users.status.write", "Change user account status", "ACTIVE"],
        ["cap_roles_read", "roles.read", "Read roles and assignments", "ACTIVE"],
        ["cap_roles_manage", "roles.manage", "Manage roles and assignments", "ACTIVE"],
        ["cap_imports_review", "imports.review", "Review COR imports", "ACTIVE"],
        ["cap_documents_read", "documents.read.support", "Read documents for support", "ACTIVE"],
        ["cap_audit_read", "audit.read", "Read audit log", "ACTIVE"],
        ["cap_sysconfig_read", "system.config.read", "Read system configuration", "ACTIVE"],
        ["cap_sysconfig_write", "system.config.write", "Write system configuration", "ACTIVE"],
        ["cap_announcements_write", "announcements.write", "Manage announcements", "ACTIVE"],
    ],
}


def generate_apps_script():
    lines = []
    lines.append("// QCU Schedule Database Setup Script")
    lines.append("// Run setupDatabase() from the Apps Script editor to create all sheets.")
    lines.append("")
    lines.append("function setupDatabase() {")
    lines.append("  const ss = SpreadsheetApp.getActiveSpreadsheet();")
    lines.append("  const existing = ss.getSheets().map(s => s.getName());")
    lines.append("  let created = 0;")
    lines.append("  let skipped = 0;")
    lines.append("")
    lines.append("  const sheets = getSheetDefinitions();")
    lines.append("")
    lines.append("  for (const [name, columns] of Object.entries(sheets)) {")
    lines.append("    if (existing.includes(name)) {")
    lines.append("      Logger.log('SKIP (exists): ' + name);")
    lines.append("      skipped++;")
    lines.append("      continue;")
    lines.append("    }")
    lines.append("    const sheet = ss.insertSheet(name);")
    lines.append("    const headerRange = sheet.getRange(1, 1, 1, columns.length);")
    lines.append("    headerRange.setValues([columns]);")
    lines.append("    headerRange.setFontWeight('bold');")
    lines.append("    headerRange.setBackground('#4A86C8');")
    lines.append("    headerRange.setFontColor('#FFFFFF');")
    lines.append("    sheet.setFrozenRows(1);")
    lines.append("    Logger.log('CREATED: ' + name + ' (' + columns.length + ' columns)');")
    lines.append("    created++;")
    lines.append("  }")
    lines.append("")
    lines.append("  Logger.log('Done. Created: ' + created + ', Skipped: ' + skipped);")
    lines.append("  SpreadsheetApp.getUi().alert(")
    lines.append("    'Database setup complete!\\n\\nCreated: ' + created + ' sheets\\nSkipped: ' + skipped + ' (already exist)'")
    lines.append("  );")
    lines.append("}")
    lines.append("")

    # getSheetDefinitions function
    lines.append("function getSheetDefinitions() {")
    lines.append("  return {")
    for i, (name, columns) in enumerate(SHEETS.items()):
        comma = "," if i < len(SHEETS) - 1 else ""
        lines.append(f'    "{name}": {repr(columns).replace("]", "]")}{comma}')
    lines.append("  };")
    lines.append("}")
    lines.append("")

    # Seed data function
    lines.append("function seedCatalogData() {")
    lines.append("  const ss = SpreadsheetApp.getActiveSpreadsheet();")
    lines.append("  let seeded = 0;")
    lines.append("")
    lines.append("  // Seed Campuses")
    lines.append('  seedRows(ss, "Campuses", getSheetDefinitions()["Campuses"], [')
    for row in SEED_DATA["Campuses"]:
        lines.append(f"    {repr(row)},")
    lines.append("  ]);")
    lines.append("  seeded++;")
    lines.append("")
    lines.append("  // Seed Departments")
    lines.append('  seedRows(ss, "Departments", getSheetDefinitions()["Departments"], [')
    for row in SEED_DATA["Departments"]:
        lines.append(f"    {repr(row)},")
    lines.append("  ]);")
    lines.append("  seeded++;")
    lines.append("")
    lines.append("  // Seed Programs")
    lines.append('  seedRows(ss, "Programs", getSheetDefinitions()["Programs"], [')
    for row in SEED_DATA["Programs"]:
        lines.append(f"    {repr(row)},")
    lines.append("  ]);")
    lines.append("  seeded++;")
    lines.append("")
    lines.append("  // Seed Academic Terms")
    lines.append('  seedRows(ss, "Academic_Terms", getSheetDefinitions()["Academic_Terms"], [')
    for row in SEED_DATA["Academic_Terms"]:
        lines.append(f"    {repr(row)},")
    lines.append("  ]);")
    lines.append("  seeded++;")
    lines.append("")
    lines.append("  // Seed Roles")
    lines.append('  seedRows(ss, "Roles", getSheetDefinitions()["Roles"], [')
    for row in SEED_DATA["Roles"]:
        lines.append(f"    {repr(row)},")
    lines.append("  ]);")
    lines.append("  seeded++;")
    lines.append("")
    lines.append("  // Seed Capabilities")
    lines.append('  seedRows(ss, "Capabilities", getSheetDefinitions()["Capabilities"], [')
    for row in SEED_DATA["Capabilities"]:
        lines.append(f"    {repr(row)},")
    lines.append("  ]);")
    lines.append("  seeded++;")
    lines.append("")
    lines.append("  SpreadsheetApp.getUi().alert('Catalog seed complete! Seeded ' + seeded + ' sheets.');")
    lines.append("}")
    lines.append("")

    # Helper function
    lines.append("function seedRows(ss, sheetName, columns, rows) {")
    lines.append("  let sheet = ss.getSheetByName(sheetName);")
    lines.append("  if (!sheet) {")
    lines.append("    Logger.log('Sheet not found: ' + sheetName);")
    lines.append("    return;")
    lines.append("  }")
    lines.append("  if (sheet.getLastRow() > 1) {")
    lines.append("    Logger.log('Sheet already has data, skipping: ' + sheetName);")
    lines.append("    return;")
    lines.append("  }")
    lines.append("  if (rows.length === 0) return;")
    lines.append("  const startRow = 2;")
    lines.append("  const range = sheet.getRange(startRow, 1, rows.length, columns.length);")
    lines.append("  range.setValues(rows);")
    lines.append("  Logger.log('Seeded ' + rows.length + ' rows into ' + sheetName);")
    lines.append("}")
    lines.append("")

    # Web app entry point (for Cloudflare to call)
    lines.append("// Web app entry point — receives signed requests from Cloudflare")
    lines.append("function doPost(e) {")
    lines.append("  try {")
    lines.append("    const data = JSON.parse(e.postData.contents);")
    lines.append("    const action = data.action;")
    lines.append("    const payload = data.payload || {};")
    lines.append("    const actor = data.actor || {};")
    lines.append("")
    lines.append("    // TODO: Verify HMAC signature from Cloudflare")
    lines.append("    // TODO: Resolve actor identity from Users sheet")
    lines.append("    // TODO: Authorization checks")
    lines.append("")
    lines.append("    switch (action) {")
    lines.append('      case "bootstrap.read":')
    lines.append("        return handleBootstrap(actor, payload);")
    lines.append('      case "profile.read":')
    lines.append("        return handleProfileRead(actor, payload);")
    lines.append('      case "catalog.list":')
    lines.append("        return handleCatalogList(actor, payload);")
    lines.append('      case "task.create":')
    lines.append("        return handleTaskCreate(actor, payload);")
    lines.append('      case "task.list":')
    lines.append("        return handleTaskList(actor, payload);")
    lines.append('      case "note.create":')
    lines.append("        return handleNoteCreate(actor, payload);")
    lines.append('      case "note.list":')
    lines.append("        return handleNoteList(actor, payload);")
    lines.append('      case "schedule.active.read":')
    lines.append("        return handleScheduleRead(actor, payload);")
    lines.append("      default:")
    lines.append('        return jsonResponse({ ok: false, error: { code: "NOT_FOUND", message: "Unknown action: " + action } }, 404);')
    lines.append("    }")
    lines.append("  } catch (err) {")
    lines.append('    return jsonResponse({ ok: false, error: { code: "INTERNAL_ERROR", message: "Server error" } }, 500);')
    lines.append("  }")
    lines.append("}")
    lines.append("")

    # Stub handlers
    lines.append("function handleBootstrap(actor, payload) {")
    lines.append("  // TODO: Look up user in Users sheet by googleSub")
    lines.append("  // TODO: Return user info, roles, active enrollment/schedule")
    lines.append('  return jsonResponse({ ok: true, data: { user: null, onboardingState: "AWAITING_COR" } });')
    lines.append("}")
    lines.append("")
    lines.append("function handleProfileRead(actor, payload) {")
    lines.append('  return jsonResponse({ ok: true, data: {} });')
    lines.append("}")
    lines.append("")
    lines.append("function handleCatalogList(actor, payload) {")
    lines.append("  const ss = SpreadsheetApp.getActiveSpreadsheet();")
    lines.append("  const entity = payload.entity || 'campuses';")
    lines.append("  const sheetMap = {")
    lines.append('    campuses: "Campuses",')
    lines.append('    departments: "Departments",')
    lines.append('    programs: "Programs",')
    lines.append('    terms: "Academic_Terms",')
    lines.append('    subjects: "Subjects",')
    lines.append('    buildings: "Buildings",')
    lines.append('    rooms: "Rooms"')
    lines.append("  };")
    lines.append("  const sheetName = sheetMap[entity];")
    lines.append("  if (!sheetName) return jsonResponse({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown catalog entity' } }, 404);")
    lines.append("  const sheet = ss.getSheetByName(sheetName);")
    lines.append("  if (!sheet) return jsonResponse({ ok: true, data: { rows: [] } });")
    lines.append("  const data = sheet.getDataRange().getValues();")
    lines.append("  if (data.length <= 1) return jsonResponse({ ok: true, data: { rows: [] } });")
    lines.append("  const headers = data[0];")
    lines.append("  const rows = data.slice(1).filter(r => r[headers.indexOf('status')] === 'ACTIVE').map(row => {")
    lines.append("    const obj = {};")
    lines.append("    headers.forEach((h, i) => obj[h] = row[i] || null);")
    lines.append("    return obj;")
    lines.append("  });")
    lines.append('  return jsonResponse({ ok: true, data: { rows, total: rows.length } });')
    lines.append("}")
    lines.append("")
    lines.append("function handleTaskCreate(actor, payload) {")
    lines.append('  return jsonResponse({ ok: true, data: { taskId: "tsk_dev_001" } });')
    lines.append("}")
    lines.append("")
    lines.append("function handleTaskList(actor, payload) {")
    lines.append('  return jsonResponse({ ok: true, data: { rows: [], total: 0 } });')
    lines.append("}")
    lines.append("")
    lines.append("function handleNoteCreate(actor, payload) {")
    lines.append('  return jsonResponse({ ok: true, data: { noteId: "nte_dev_001" } });')
    lines.append("}")
    lines.append("")
    lines.append("function handleNoteList(actor, payload) {")
    lines.append('  return jsonResponse({ ok: true, data: { rows: [], total: 0 } });')
    lines.append("}")
    lines.append("")
    lines.append("function handleScheduleRead(actor, payload) {")
    lines.append('  return jsonResponse({ ok: true, data: { schedule: null, entries: [] } });')
    lines.append("}")
    lines.append("")
    lines.append("function jsonResponse(data, statusCode) {")
    lines.append("  return ContentService")
    lines.append("    .createTextOutput(JSON.stringify(data))")
    lines.append('    .setMimeType(ContentService.MimeType.JSON);')
    lines.append("}")
    lines.append("")

    # doGet for health check
    lines.append("function doGet(e) {")
    lines.append('  const action = e.parameter.action;')
    lines.append('  if (action === "health") {')
    lines.append('    return jsonResponse({ ok: true, status: "healthy", sheets: Object.keys(getSheetDefinitions()).length });')
    lines.append("  }")
    lines.append('  return jsonResponse({ ok: true, message: "QCU Schedule API" });')
    lines.append("}")

    return "\n".join(lines)


if __name__ == "__main__":
    code = generate_apps_script()
    with open("setup-database.gs", "w", encoding="utf-8") as f:
        f.write(code)
    print(f"Generated setup-database.gs ({len(code)} chars, {len(SHEETS)} sheets)")
