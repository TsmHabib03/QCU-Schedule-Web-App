// POST /api/v1/cor/confirm
// Final confirmation: validates reviewed draft, creates student profile,
// enrollment, enrollment subjects, schedule, and schedule entries.
// Transitions user to ACTIVE state.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import {
  CorRecords,
  CorDrafts,
  Profiles,
  Enrollments,
  EnrollmentSubjects,
  Schedules,
  ScheduleEntries,
  Campuses,
  Programs,
  Terms,
  Subjects,
  CatalogBuildings,
  CatalogRooms,
} from "../../repo/index.js";

// In-memory stores for confirmed data — NOW DELEGATED TO REPO
// (Profiles, Enrollments, EnrollmentSubjects, Schedules, ScheduleEntries
//  are imported from the repo module above)

const DAY_MAP = {
  "Monday": 1, "Tuesday": 2, "Wednesday": 3,
  "Thursday": 4, "Friday": 5, "Saturday": 6, "Sunday": 0,
};

// ---------------------------------------------------------------------------
// Final validation
// ---------------------------------------------------------------------------
function validateDraft(draft, catalog) {
  const issues = [];

  // Student info validation
  if (!draft.studentInfo?.firstName?.value) issues.push({ field: "studentInfo.firstName", message: "First name is required." });
  if (!draft.studentInfo?.lastName?.value) issues.push({ field: "studentInfo.lastName", message: "Last name is required." });
  if (!draft.studentInfo?.studentNumber?.value) issues.push({ field: "studentInfo.studentNumber", message: "Student number is required." });

  // Enrollment validation
  if (!draft.enrollmentInfo?.program?.value) issues.push({ field: "enrollmentInfo.program", message: "Program is required." });
  if (!draft.enrollmentInfo?.yearLevel?.value) issues.push({ field: "enrollmentInfo.yearLevel", message: "Year level is required." });
  if (!draft.enrollmentInfo?.term?.value) issues.push({ field: "enrollmentInfo.term", message: "Term is required." });

  // Validate year level
  const yearLevel = draft.enrollmentInfo?.yearLevel?.value;
  if (yearLevel && (yearLevel < 1 || yearLevel > 5)) {
    issues.push({ field: "enrollmentInfo.yearLevel", message: "Year level must be between 1 and 5." });
  }

  // Subject validation
  if (!Array.isArray(draft.subjects) || draft.subjects.length === 0) {
    issues.push({ field: "subjects", message: "At least one subject is required." });
  } else {
    for (let i = 0; i < draft.subjects.length; i++) {
      const s = draft.subjects[i];
      if (!s.subjectCode?.value) issues.push({ field: `subjects[${i}].subjectCode`, message: "Subject code is required." });
      if (!s.subjectName?.value) issues.push({ field: `subjects[${i}].subjectName`, message: "Subject name is required." });

      // Validate schedule days
      if (s.schedule) {
        for (let j = 0; j < s.schedule.length; j++) {
          const m = s.schedule[j];
          if (m.day?.value && !(m.day.value in DAY_MAP)) {
            issues.push({ field: `subjects[${i}].schedule[${j}].day`, message: `Invalid day: ${m.day.value}` });
          }
          if (m.time?.start && m.time?.end) {
            // Validate time format HH:mm
            if (!/^\d{2}:\d{2}$/.test(m.time.start) || !/^\d{2}:\d{2}$/.test(m.time.end)) {
              issues.push({ field: `subjects[${i}].schedule[${j}].time`, message: "Invalid time format." });
            }
          }
        }
      }
    }
  }

  // Check for schedule conflicts (same day + overlapping time)
  if (draft.subjects) {
    for (let i = 0; i < draft.subjects.length; i++) {
      const s1 = draft.subjects[i];
      if (!s1.schedule) continue;
      for (let j = 0; j < draft.subjects.length; j++) {
        if (i >= j) continue;
        const s2 = draft.subjects[j];
        if (!s2.schedule) continue;
        for (const m1 of s1.schedule) {
          for (const m2 of s2.schedule) {
            if (m1.day?.value !== m2.day?.value) continue;
            if (m1.time?.start && m1.time?.end && m2.time?.start && m2.time?.end) {
              if (m1.time.start < m2.time.end && m2.time.start < m1.time.end) {
                issues.push({
                  field: "schedule",
                  message: `Schedule conflict: ${s1.subjectCode?.value} and ${s2.subjectCode?.value} on ${m1.day.value} (${m1.time.start}-${m1.time.end} vs ${m2.time.start}-${m2.time.end})`,
                });
              }
            }
          }
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Commit logic — create all records in one operation (via repository)
// ---------------------------------------------------------------------------
function commitRecords(user, draft, _catalog) {
  // 1. Create Student Profile
  const profile = Profiles.create({
    userId: user.userId,
    studentNumber: draft.studentInfo.studentNumber.value,
    firstName: draft.studentInfo.firstName.value,
    middleName: draft.studentInfo.middleName?.value || null,
    lastName: draft.studentInfo.lastName.value,
    suffix: draft.studentInfo.suffix?.value || null,
    verificationStatus: "COR_REVIEWED",
    sourceCorRecordId: user.corRecordId,
  });

  // 2. Resolve program and campus from catalog (using repo modules)
  const programCode = draft.enrollmentInfo.program.value;
  const matchedProgram = draft.enrollmentInfo.program.matchedProgramId
    ? Programs.getById(draft.enrollmentInfo.program.matchedProgramId)
    : Programs.getByCode(programCode);

  const campusName = draft.enrollmentInfo.campus?.value;
  const matchedCampus = draft.enrollmentInfo.campus?.matchedCampusId
    ? Campuses.getById(draft.enrollmentInfo.campus.matchedCampusId)
    : (campusName ? Campuses.getAll().find(c => c.name.includes(campusName)) : null);

  const termLabel = draft.enrollmentInfo.term.value;
  const matchedTerm = draft.enrollmentInfo.term.matchedTermId
    ? Terms.getById(draft.enrollmentInfo.term.matchedTermId)
    : Terms.getAll().find(t => t.name.includes(termLabel));

  // 3. Create Enrollment
  const enrollment = Enrollments.create({
    userId: user.userId,
    profileId: profile.profileId,
    termId: matchedTerm?.termId || null,
    programId: matchedProgram?.programId || null,
    campusId: matchedCampus?.campusId || null,
    yearLevel: draft.enrollmentInfo.yearLevel.value,
    sectionLabelSnapshot: draft.enrollmentInfo.section?.value || null,
    adviserName: draft.enrollmentInfo.adviserName?.value || null,
    sourceType: "COR_IMPORT",
    sourceCorRecordId: user.corRecordId,
  });

  // 4. Create Enrollment Subjects and Schedule
  const schedule = Schedules.create({
    enrollmentId: enrollment.enrollmentId,
    userId: user.userId,
    sourceType: "COR_IMPORT",
    sourceCorRecordId: user.corRecordId,
  });

  let entryIndex = 0;
  for (const subject of draft.subjects) {
    const enrollmentSubject = EnrollmentSubjects.create({
      enrollmentId: enrollment.enrollmentId,
      userId: user.userId,
      subjectCodeSnapshot: subject.subjectCode.value,
      subjectTitleSnapshot: subject.subjectName.value,
      units: subject.units?.value || 0,
      matchedSubjectId: subject.matchedSubjectId || null,
      matchedRoomId: subject.room?.matchedRoomId || null,
      matchedBuildingId: subject.room?.matchedBuildingId || null,
      roomSnapshot: subject.room?.value || null,
      sourceType: "COR_IMPORT",
    });

    // Create schedule entries for each meeting
    if (subject.schedule) {
      for (const meeting of subject.schedule) {
        entryIndex++;
        ScheduleEntries.create({
          scheduleId: schedule.scheduleId,
          enrollmentId: enrollment.enrollmentId,
          userId: user.userId,
          enrollmentSubjectId: enrollmentSubject.ensId,
          dayOfWeek: DAY_MAP[meeting.day?.value] ?? null,
          dayLabel: meeting.day?.value || null,
          startTime: meeting.time?.start || null,
          endTime: meeting.time?.end || null,
          locationText: subject.room?.value || null,
          buildingId: subject.room?.matchedBuildingId || null,
          roomId: subject.room?.matchedRoomId || null,
          sortOrder: entryIndex,
        });
      }
    }
  }

  // 5. Update COR record to COMPLETE
  const corRecord = CorRecords.getById(user.corRecordId);
  if (corRecord) {
    CorRecords.update(corRecord, { status: "COMPLETE" });
  }

  // 6. Update user state
  user.state = "ACTIVE";
  // Update user.name with COR-extracted name so it's used everywhere
  const nameParts = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean);
  if (nameParts.length) user.name = nameParts.join(" ");
  user.profile = {
    profileId: profile.profileId,
    studentNumber: profile.studentNumber,
    firstName: profile.firstName,
    middleName: profile.middleName,
    lastName: profile.lastName,
    suffix: profile.suffix,
    verificationStatus: profile.verificationStatus,
  };

  return {
    profileId: profile.profileId,
    enrollmentId: enrollment.enrollmentId,
    scheduleId: schedule.scheduleId,
    subjectCount: draft.subjects.length,
    entryCount: entryIndex,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function onRequestPost(context) {
  try {
    const session = await readPlatformSession(context);
    if (!session) {
      return json({ status: "UNAUTHORIZED", error: "Not authenticated" }, 401);
    }

    const user = getUserByGoogleSub(session.googleSub);
    if (!user) {
      return json({ status: "NOT_FOUND", error: "User not found" }, 404);
    }

    if (user.state !== "ONBOARDING" || !user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import to confirm." },
        400
      );
    }

    const record = CorRecords.getById(user.corRecordId);
    if (!record) {
      return json(
        { status: "ERROR", error: "COR record not found." },
        404
      );
    }

    if (record.status !== "REVIEW_REQUIRED") {
      return json(
        { status: "ERROR", error: `Cannot confirm COR in state: ${record.status}` },
        400
      );
    }

    const draft = CorDrafts.get(record.id);
    if (!draft) {
      return json(
        { status: "ERROR", error: "No extraction draft found." },
        400
      );
    }

    // Build a lightweight catalog object for validation from repo modules
    const catalogForValidation = {
      programs: Programs.getAll(),
      campuses: Campuses.getAll(),
      terms: Terms.getAll(),
      subjects: Subjects.getAll(),
    };

    // Final validation
    const validationIssues = validateDraft(draft, catalogForValidation);
    if (validationIssues.length > 0) {
      return json(
        {
          status: "VALIDATION_ERROR",
          error: "Please fix the following issues before confirming.",
          issues: validationIssues,
        },
        400
      );
    }

    // Transition to COMMITTING
    CorRecords.update(record, { status: "COMMITTING" });

    // Commit records
    const result = commitRecords(user, draft, catalogForValidation);

    return json({
      status: "COMPLETE",
      corRecordId: record.id,
      profileId: result.profileId,
      enrollmentId: result.enrollmentId,
      scheduleId: result.scheduleId,
      subjectCount: result.subjectCount,
      entryCount: result.entryCount,
      message: "Your student profile and schedule have been created.",
    });
  } catch (error) {
    console.error("COR confirmation failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to confirm COR. Please try again." },
      500
    );
  }
}
