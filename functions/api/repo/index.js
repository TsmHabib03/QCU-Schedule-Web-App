// Repository layer — centralized persistence for My-Schedule.
//
// This module wraps all data access behind a single interface.
// In development, it uses in-memory Maps (the current dev adapter).
// In production, it will use Google Sheets via Apps Script.
//
// All API endpoints import from this module instead of accessing
// in-memory Maps directly. This makes the persistence backend
// swappable without changing endpoint code.

// ---------------------------------------------------------------------------
// In-memory dev adapter (replaces _users, _corRecords, _corFiles, etc.)
// ---------------------------------------------------------------------------

const _users = new Map();           // googleSub -> User record
const _corRecords = new Map();      // corRecordId -> COR record
const _corFiles = new Map();        // corRecordId -> { bytes, filename, mimeType }
const _corDrafts = new Map();       // corRecordId -> extraction draft
const _profiles = new Map();        // profileId -> Student_Profile
const _enrollments = new Map();     // enrollmentId -> Enrollment
const _enrollmentSubjects = new Map(); // ensId -> Enrollment_Subject
const _schedules = new Map();       // scheduleId -> Schedule
const _scheduleEntries = new Map(); // smeId -> Schedule_Entry
const _tasks = new Map();           // taskId -> Task
const _notes = new Map();           // noteId -> Note

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Change tracking
// ---------------------------------------------------------------------------
// Endpoints keep calling the repository synchronously; persistence happens once
// per request instead of once per call. Every mutating method records what it
// touched here, and Repo.flush() ships the whole set to Apps Script in a single
// batch.write. See sheets-adapter.js for why one round trip matters so much.

const _dirty = new Map(); // `${kind}:${id}` -> { kind, id, remove }

function markDirty(kind, id, remove = false) {
  if (!id) return;
  _dirty.set(`${kind}:${id}`, { kind, id, remove });
}

// ---------------------------------------------------------------------------
// Persistence lifecycle
// ---------------------------------------------------------------------------
// Without APPS_SCRIPT_URL the maps below are the whole database, which is fine
// for `npm run dev` and is exactly how this repository behaved before.
//
// With it configured, each request runs:
//   1. Repo.hydrate(env, actor)  one snapshot.read, merged into the maps
//   2. ...ordinary synchronous repository calls...
//   3. Repo.flush(env, actor)    one batch.write of whatever changed
//
// Rows for other users may linger in the maps between requests in the same
// isolate. That is safe because every lookup either filters on the owner or is
// followed by an ownership check in the endpoint, so another user's row is
// unreachable rather than merely unlikely to be read.

import {
  isConfigured as sheetsConfigured,
  readSnapshot,
  writeBatch,
} from "./sheets-adapter.js";

const MAX_CACHED_USERS = 200;

const _hydratedUsers = new Set();
const _inflightHydrate = new Map(); // userId -> Promise

/** Where each entity kind lives, and how to read or write one row of it. */
function entityBindings() {
  return {
    users: {
      put: (obj) => _users.set(obj.googleSub, obj),
      get: (id) => Users.getById(id),
    },
    profiles: {
      put: (obj) => _profiles.set(obj.profileId, obj),
      get: (id) => _profiles.get(id) || null,
    },
    corRecords: {
      put: (obj) => _corRecords.set(obj.id, obj),
      get: (id) => _corRecords.get(id) || null,
    },
    corDrafts: {
      // The snapshot wraps the draft; the map stores the draft itself.
      put: (obj) => { if (obj.draft) _corDrafts.set(obj.corRecordId, obj.draft); },
      get: (id) => {
        const draft = _corDrafts.get(id);
        if (!draft) return null;
        const record = _corRecords.get(id);
        return {
          corRecordId: id,
          ownerUserId: record ? record.ownerUserId : null,
          draftVersion: record ? record.draftVersion || 1 : 1,
          draft,
        };
      },
    },
    enrollments: {
      put: (obj) => _enrollments.set(obj.enrollmentId, obj),
      get: (id) => _enrollments.get(id) || null,
    },
    enrollmentSubjects: {
      put: (obj) => _enrollmentSubjects.set(obj.ensId, obj),
      get: (id) => _enrollmentSubjects.get(id) || null,
    },
    schedules: {
      put: (obj) => _schedules.set(obj.scheduleId, obj),
      get: (id) => _schedules.get(id) || null,
    },
    scheduleEntries: {
      put: (obj) => _scheduleEntries.set(obj.smeId, obj),
      get: (id) => _scheduleEntries.get(id) || null,
    },
    tasks: {
      put: (obj) => _tasks.set(obj.taskId, obj),
      get: (id) => _tasks.get(id) || null,
    },
    notes: {
      put: (obj) => _notes.set(obj.noteId, obj),
      get: (id) => _notes.get(id) || null,
    },
  };
}

export const Repo = {
  /** True when a Sheets backend is configured for this environment. */
  enabled(env) {
    return sheetsConfigured(env);
  },

  /** Number of rows waiting to be written. */
  pending() {
    return _dirty.size;
  },

  /**
   * Load this user's rows from Sheets into the in-memory maps.
   * A no-op when Sheets is not configured, so local dev is unaffected.
   * Returns { hydrated, isNew, counts } — `isNew` means Sheets has no Users row
   * for this googleSub yet.
   */
  async hydrate(env, actor) {
    if (!sheetsConfigured(env) || !actor?.googleSub) {
      return { hydrated: false, isNew: false, counts: {} };
    }

    const key = actor.googleSub;
    if (_inflightHydrate.has(key)) return _inflightHydrate.get(key);

    const work = (async () => {
      // Bound isolate memory, but only while nothing is mid-write.
      if (_hydratedUsers.size > MAX_CACHED_USERS && _dirty.size === 0) {
        clearUserData();
      }

      const bindings = entityBindings();
      const snapshot = await readSnapshot(env, actor);
      const counts = {};

      for (const [kind, rows] of Object.entries(snapshot.entities)) {
        const binding = bindings[kind];
        if (!binding) continue;
        for (const row of rows) binding.put(row);
        counts[kind] = rows.length;
      }

      // Hydration is not a change; anything it wrote must not be echoed back.
      _dirty.clear();
      _hydratedUsers.add(key);

      return { hydrated: true, isNew: snapshot.isNew, counts };
    })();

    _inflightHydrate.set(key, work);
    try {
      return await work;
    } finally {
      _inflightHydrate.delete(key);
    }
  },

  /**
   * Write every change made since the last hydrate or flush.
   * A no-op when Sheets is not configured or nothing changed.
   */
  async flush(env, actor) {
    if (!sheetsConfigured(env) || _dirty.size === 0) {
      return { flushed: false, applied: 0 };
    }

    const bindings = entityBindings();
    const ops = [];

    for (const { kind, id, remove } of _dirty.values()) {
      const binding = bindings[kind];
      if (!binding) continue;

      if (remove) {
        ops.push({ kind, id, remove: true });
        continue;
      }

      const obj = binding.get(id);
      // Created then hard-deleted inside one request: nothing left to write.
      if (!obj) continue;
      ops.push({ kind, id, obj });
    }

    // Clear before awaiting so a failed write cannot be replayed twice, and so
    // a concurrent request in this isolate does not pick up these same rows.
    _dirty.clear();

    if (!ops.length) return { flushed: false, applied: 0 };

    const result = await writeBatch(env, actor, ops);
    return { flushed: true, ...result };
  },

  /** Drop every user-owned row from memory. Catalog data is left intact. */
  reset() {
    clearUserData();
  },
};

function clearUserData() {
  _users.clear();
  _corRecords.clear();
  _corFiles.clear();
  _corDrafts.clear();
  _profiles.clear();
  _enrollments.clear();
  _enrollmentSubjects.clear();
  _schedules.clear();
  _scheduleEntries.clear();
  _tasks.clear();
  _notes.clear();
  _dirty.clear();
  _hydratedUsers.clear();
}




// ---------------------------------------------------------------------------
// User repository
// ---------------------------------------------------------------------------

export const Users = {
  /** Generate a stable internal userId from a Google subject. */
  resolveId(googleSub) {
    return `user_${googleSub}`;
  },

  /** Find a user by their Google subject. Returns null if not found. */
  getByGoogleSub(googleSub) {
    return _users.get(googleSub) || null;
  },

  /** Find a user by internal userId. Returns null if not found. */
  getById(userId) {
    for (const user of _users.values()) {
      if (user.userId === userId) return user;
    }
    return null;
  },

  /** Return all users (admin/dev use). */
  getAll() {
    return Array.from(_users.values());
  },

  /**
   * Create or update a user by Google subject.
   * If the user exists, updates profile fields and updatedAt.
   * If new, creates a full user record with AUTHENTICATED state.
   * Returns the user record.
   */
  upsert(googleSub, profile) {
    const existing = _users.get(googleSub);
    const ts = now();
    if (existing) {
      existing.name = profile.name || existing.name;
      existing.picture = profile.picture || existing.picture;
      existing.email = profile.email || existing.email;
      existing.lastLoginAt = ts;
      existing.updatedAt = ts;
      markDirty("users", existing.userId);
      return existing;
    }
    const userId = this.resolveId(googleSub);
    const user = {
      userId,
      googleSub,
      email: profile.email || "",
      name: profile.name || "",
      picture: profile.picture || "",
      state: "AUTHENTICATED",
      role: "student",
      profile: null,
      corRecordId: null,
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: ts,
    };
    _users.set(googleSub, user);
    markDirty("users", user.userId);
    return user;
  },

  /** Update a user record in-place. Caller is responsible for field validity. */
  update(user, fields) {
    const ts = now();
    Object.assign(user, fields, { updatedAt: ts });
    markDirty("users", user.userId);
    return user;
  },

  /**
   * Put an existing user object into the map without recording a change.
   *
   * resolveUser() rebuilds a user from the session cookie when Sheets has no row
   * yet (or could not be reached). Adopting that object makes it the same record
   * every other repository call sees, so a later Users.update() marks the right
   * row dirty instead of mutating an orphan. Deliberately not dirty: adopting is
   * not an edit, and marking it would turn every read into a write.
   */
  adopt(user) {
    if (!user || !user.googleSub) return user;
    if (!_users.has(user.googleSub)) _users.set(user.googleSub, user);
    return _users.get(user.googleSub);
  },
};

// ---------------------------------------------------------------------------
// COR Records repository
// ---------------------------------------------------------------------------

export const CorRecords = {
  /** Create a new COR record. Returns the record. */
  create(fields) {
    const ts = now();
    const record = {
      id: fields.id || generateId("cor"),
      ownerUserId: fields.ownerUserId,
      filename: fields.filename,
      originalFilename: fields.originalFilename || fields.filename,
      mimeType: fields.mimeType,
      sizeBytes: fields.sizeBytes,
      contentHash: fields.contentHash || null,
      status: fields.status || "ACCEPTED",
      pipelineVersion: fields.pipelineVersion || "dev-mock-1",
      extractionSchemaVersion: fields.extractionSchemaVersion || "1",
      attemptNumber: fields.attemptNumber || 1,
      draftVersion: fields.draftVersion || 0,
      failureCode: null,
      failureStage: null,
      createdAt: ts,
      updatedAt: ts,
    };
    _corRecords.set(record.id, record);
    markDirty("corRecords", record.id);
    return record;
  },

  /** Get a COR record by ID. Returns null if not found. */
  getById(corRecordId) {
    return _corRecords.get(corRecordId) || null;
  },

  /**
   * Find the active (non-terminal) COR record for a user.
   * Returns the record or null.
   */
  getActiveByUserId(userId) {
    for (const record of _corRecords.values()) {
      if (record.ownerUserId === userId && !["CANCELLED", "DELETED", "COMPLETE"].includes(record.status)) {
        return record;
      }
    }
    return null;
  },

  /** Update a COR record in-place. */
  update(record, fields) {
    const ts = now();
    Object.assign(record, fields, { updatedAt: ts });
    markDirty("corRecords", record.id);
    return record;
  },

  /** Check if user has any non-terminal COR records. */
  hasActive(userId) {
    for (const record of _corRecords.values()) {
      if (record.ownerUserId === userId && !["CANCELLED", "DELETED", "COMPLETE"].includes(record.status)) {
        return true;
      }
    }
    return false;
  },
};

// ---------------------------------------------------------------------------
// COR Files repository (dev: in-memory bytes; prod: Google Drive)
// ---------------------------------------------------------------------------

export const CorFiles = {
  /**
   * Store the uploaded bytes for the current request only.
   *
   * These never reach Sheets: a cell holds 50 000 characters and a COR scan is
   * megabytes. The upload endpoint therefore runs extraction in the same
   * request that receives the file, so the bytes never need to outlive it. Only
   * the resulting draft is persisted (see CorDrafts).
   */
  store(corRecordId, fileData) {
    _corFiles.set(corRecordId, {
      bytes: fileData.bytes,
      filename: fileData.filename,
      mimeType: fileData.mimeType,
    });
    return { documentId: `doc_${corRecordId}` };
  },

  /** Retrieve file data. Returns null if not found. */
  get(corRecordId) {
    return _corFiles.get(corRecordId) || null;
  },
};

// ---------------------------------------------------------------------------
// COR Drafts repository (extraction results / reviewed corrections)
// ---------------------------------------------------------------------------

export const CorDrafts = {
  /** Save or overwrite the extraction draft for a COR record. */
  set(corRecordId, draft) {
    _corDrafts.set(corRecordId, draft);
    markDirty("corDrafts", corRecordId);
    return draft;
  },

  /** Get the extraction draft. Returns null if not found. */
  get(corRecordId) {
    return _corDrafts.get(corRecordId) || null;
  },

  /** Delete a draft (e.g., on COR cancellation). */
  delete(corRecordId) {
    _corDrafts.delete(corRecordId);
    markDirty("corDrafts", corRecordId, true);
  },
};

// ---------------------------------------------------------------------------
// Student Profiles repository
// ---------------------------------------------------------------------------

export const Profiles = {
  /** Create a student profile. Returns the profile. */
  create(fields) {
    const ts = now();
    const profile = {
      profileId: fields.profileId || generateId("prf"),
      userId: fields.userId,
      studentNumber: fields.studentNumber,
      firstName: fields.firstName,
      middleName: fields.middleName || null,
      lastName: fields.lastName,
      suffix: fields.suffix || null,
      preferredName: null,
      verificationStatus: fields.verificationStatus || "COR_REVIEWED",
      sourceCorRecordId: fields.sourceCorRecordId || null,
      status: fields.status || "ACTIVE",
      createdAt: ts,
      updatedAt: ts,
    };
    _profiles.set(profile.profileId, profile);
    markDirty("profiles", profile.profileId);
    return profile;
  },

  /** Get profile by ID. Returns null if not found. */
  getById(profileId) {
    return _profiles.get(profileId) || null;
  },

  /** Get profile by owner userId. Returns null if not found. */
  getByUserId(userId) {
    for (const p of _profiles.values()) {
      if (p.userId === userId) return p;
    }
    return null;
  },

  /** Update profile fields. */
  update(profile, fields) {
    const ts = now();
    Object.assign(profile, fields, { updatedAt: ts });
    markDirty("profiles", profile.profileId);
    return profile;
  },
};

// ---------------------------------------------------------------------------
// Enrollments repository
// ---------------------------------------------------------------------------

export const Enrollments = {
  /** Create an enrollment. Returns the enrollment. */
  create(fields) {
    const ts = now();
    const enrollment = {
      enrollmentId: fields.enrollmentId || generateId("enr"),
      userId: fields.userId,
      profileId: fields.profileId,
      termId: fields.termId || null,
      programId: fields.programId || null,
      campusId: fields.campusId || null,
      offeringId: fields.offeringId || null,
      sectionId: fields.sectionId || null,
      sectionLabelSnapshot: fields.sectionLabelSnapshot || null,
      yearLevel: fields.yearLevel,
      studentStatus: fields.studentStatus || "UNKNOWN",
      dateEnrolled: fields.dateEnrolled || null,
      adviserName: fields.adviserName || null,
      sourceType: fields.sourceType || "COR_IMPORT",
      sourceCorRecordId: fields.sourceCorRecordId || null,
      status: fields.status || "ACTIVE",
      createdAt: ts,
      updatedAt: ts,
    };
    _enrollments.set(enrollment.enrollmentId, enrollment);
    markDirty("enrollments", enrollment.enrollmentId);
    return enrollment;
  },

  /** Get enrollment by ID. */
  getById(enrollmentId) {
    return _enrollments.get(enrollmentId) || null;
  },

  /** Get all enrollments for a user. */
  getByUserId(userId) {
    return Array.from(_enrollments.values()).filter((e) => e.userId === userId);
  },

  /** Update enrollment fields. */
  update(enrollment, fields) {
    const ts = now();
    Object.assign(enrollment, fields, { updatedAt: ts });
    markDirty("enrollments", enrollment.enrollmentId);
    return enrollment;
  },
};

// ---------------------------------------------------------------------------
// Enrollment Subjects repository
// ---------------------------------------------------------------------------

export const EnrollmentSubjects = {
  /** Create an enrollment subject. Returns the record. */
  create(fields) {
    const ts = now();
    const subject = {
      ensId: fields.ensId || generateId("ens"),
      enrollmentId: fields.enrollmentId,
      userId: fields.userId,
      subjectId: fields.subjectId || null,
      subjectCodeSnapshot: fields.subjectCodeSnapshot || fields.subjectCode,
      subjectTitleSnapshot: fields.subjectTitleSnapshot || fields.subjectName,
      units: fields.units || 0,
      classSection: fields.classSection || null,
      instructorName: fields.instructorName || null,
      matchedSubjectId: fields.matchedSubjectId || null,
      matchedRoomId: fields.matchedRoomId || null,
      matchedBuildingId: fields.matchedBuildingId || null,
      roomSnapshot: fields.roomSnapshot || null,
      sourceType: fields.sourceType || "COR_IMPORT",
      sourceCorDraftSubjectId: fields.sourceCorDraftSubjectId || null,
      scheduleStatus: fields.scheduleStatus || "ACTIVE",
      status: fields.status || "ACTIVE",
      createdAt: ts,
      updatedAt: ts,
    };
    _enrollmentSubjects.set(subject.ensId, subject);
    markDirty("enrollmentSubjects", subject.ensId);
    return subject;
  },

  /** Get enrollment subject by ID. */
  getById(ensId) {
    return _enrollmentSubjects.get(ensId) || null;
  },

  /** Get all enrollment subjects for a given enrollment. */
  getByEnrollmentId(enrollmentId) {
    return Array.from(_enrollmentSubjects.values()).filter(
      (s) => s.enrollmentId === enrollmentId
    );
  },

  /** Get all enrollment subjects for a user. */
  getByUserId(userId) {
    return Array.from(_enrollmentSubjects.values()).filter(
      (s) => s.userId === userId
    );
  },
};

// ---------------------------------------------------------------------------
// Schedules repository
// ---------------------------------------------------------------------------

export const Schedules = {
  /** Create a schedule header. Returns the schedule. */
  create(fields) {
    const ts = now();
    const schedule = {
      scheduleId: fields.scheduleId || generateId("sch"),
      enrollmentId: fields.enrollmentId,
      userId: fields.userId,
      revisionNumber: fields.revisionNumber || 1,
      name: fields.name || "Official Schedule",
      isActive: fields.isActive !== undefined ? fields.isActive : true,
      sourceType: fields.sourceType || "COR_IMPORT",
      sourceCorRecordId: fields.sourceCorRecordId || null,
      revisionReason: fields.revisionReason || null,
      scheduleStatus: fields.scheduleStatus || "ACTIVE",
      status: fields.status || "ACTIVE",
      activatedAt: ts,
      archivedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    _schedules.set(schedule.scheduleId, schedule);
    markDirty("schedules", schedule.scheduleId);
    return schedule;
  },

  /** Get schedule by ID. */
  getById(scheduleId) {
    return _schedules.get(scheduleId) || null;
  },

  /** Get active schedule for a user. Returns null if none. */
  getActiveByUserId(userId) {
    for (const s of _schedules.values()) {
      if (s.userId === userId && s.isActive && s.status === "ACTIVE") return s;
    }
    return null;
  },

  /** Update schedule fields. */
  update(schedule, fields) {
    const ts = now();
    Object.assign(schedule, fields, { updatedAt: ts });
    markDirty("schedules", schedule.scheduleId);
    return schedule;
  },
};

// ---------------------------------------------------------------------------
// Schedule Entries repository
// ---------------------------------------------------------------------------

export const ScheduleEntries = {
  /** Create a schedule entry (one meeting). Returns the entry. */
  create(fields) {
    const ts = now();
    const entry = {
      smeId: fields.smeId || generateId("sme"),
      scheduleId: fields.scheduleId,
      enrollmentId: fields.enrollmentId,
      userId: fields.userId,
      enrollmentSubjectId: fields.enrollmentSubjectId,
      dayOfWeek: fields.dayOfWeek,
      dayLabel: fields.dayLabel || null,
      startTime: fields.startTime,
      endTime: fields.endTime,
      modality: fields.modality || "ONSITE",
      buildingId: fields.buildingId || null,
      roomId: fields.roomId || null,
      locationText: fields.locationText || null,
      effectiveFrom: fields.effectiveFrom || null,
      effectiveTo: fields.effectiveTo || null,
      sortOrder: fields.sortOrder || 0,
      sourceCorDraftMeetingId: fields.sourceCorDraftMeetingId || null,
      originType: fields.originType || "COR_IMPORT",
      status: fields.status || "ACTIVE",
      createdAt: ts,
      updatedAt: ts,
    };
    _scheduleEntries.set(entry.smeId, entry);
    markDirty("scheduleEntries", entry.smeId);
    return entry;
  },

  /** Get entry by ID. */
  getById(smeId) {
    return _scheduleEntries.get(smeId) || null;
  },

  /** Get all entries for a schedule. */
  getByScheduleId(scheduleId) {
    return Array.from(_scheduleEntries.values())
      .filter((e) => e.scheduleId === scheduleId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  /** Get all entries for a user. */
  getByUserId(userId) {
    return Array.from(_scheduleEntries.values()).filter(
      (e) => e.userId === userId
    );
  },

  /**
   * Check for time conflicts within a schedule.
   * Returns an array of conflicting entries. Empty if no conflict.
   * If excludeId is provided, that entry is skipped (for update scenarios).
   */
  hasConflict(scheduleId, dayOfWeek, startTime, endTime, excludeId) {
    const conflicts = [];
    for (const e of _scheduleEntries.values()) {
      if (e.scheduleId !== scheduleId) continue;
      if (e.dayOfWeek !== dayOfWeek) continue;
      if (e.status !== "ACTIVE") continue;
      if (excludeId && e.smeId === excludeId) continue;
      // Overlap: A.start < B.end AND B.start < A.end
      if (startTime < e.endTime && e.startTime < endTime) {
        conflicts.push(e);
      }
    }
    return conflicts;
  },

  /** Update a schedule entry in-place. Caller must verify ownership. */
  update(entry, fields) {
    const ts = now();
    Object.assign(entry, fields, { updatedAt: ts });
    markDirty("scheduleEntries", entry.smeId);
    return entry;
  },

  /** Delete a schedule entry (physical removal). Prefer soft-delete via update. */
  delete(smeId) {
    markDirty("scheduleEntries", smeId, true);
    return _scheduleEntries.delete(smeId);
  },
};

// ---------------------------------------------------------------------------
// Tasks repository (student-owned productivity tasks)
// ---------------------------------------------------------------------------

export const Tasks = {
  /** Create a task. Returns the task. */
  create(fields) {
    const ts = now();
    const task = {
      taskId: fields.taskId || generateId("tsk"),
      userId: fields.userId,
      title: (fields.title || "").slice(0, 300),
      description: (fields.description || "").slice(0, 4000),
      priority: fields.priority || "MEDIUM",
      status: fields.status || "OPEN",
      subjectId: fields.subjectId || null,
      enrollmentSubjectId: fields.enrollmentSubjectId || null,
      scheduleEntryId: fields.scheduleEntryId || null,
      dueDate: fields.dueDate || null,
      completedAt: null,
      deletedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    _tasks.set(task.taskId, task);
    markDirty("tasks", task.taskId);
    return task;
  },

  /** Get task by ID. Returns null if not found. */
  getById(taskId) {
    return _tasks.get(taskId) || null;
  },

  /** Get all active (non-deleted) tasks for a user. */
  getByUserId(userId) {
    return Array.from(_tasks.values())
      .filter((t) => t.userId === userId && t.status !== "DELETED")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** Update a task in-place. Caller must verify ownership. */
  update(task, fields) {
    const ts = now();
    Object.assign(task, fields, { updatedAt: ts });
    markDirty("tasks", task.taskId);
    return task;
  },

  /** Soft-delete a task (mark as DELETED). */
  delete(taskId) {
    const task = _tasks.get(taskId);
    if (task) {
      const ts = now();
      task.status = "DELETED";
      task.deletedAt = ts;
      task.updatedAt = ts;
      markDirty("tasks", taskId);
    }
  },
};

// ---------------------------------------------------------------------------
// Notes repository (student-owned productivity notes)
// ---------------------------------------------------------------------------

export const Notes = {
  /** Create a note. Returns the note. */
  create(fields) {
    const ts = now();
    const note = {
      noteId: fields.noteId || generateId("nt"),
      userId: fields.userId,
      title: (fields.title || "").slice(0, 300),
      body: (fields.body || "").slice(0, 12000),
      subjectId: fields.subjectId || null,
      enrollmentSubjectId: fields.enrollmentSubjectId || null,
      scheduleEntryId: fields.scheduleEntryId || null,
      status: fields.status || "ACTIVE",
      deletedAt: null,
      createdAt: ts,
      updatedAt: ts,
    };
    _notes.set(note.noteId, note);
    markDirty("notes", note.noteId);
    return note;
  },

  /** Get note by ID. Returns null if not found. */
  getById(noteId) {
    return _notes.get(noteId) || null;
  },

  /** Get all active (non-deleted) notes for a user. */
  getByUserId(userId) {
    return Array.from(_notes.values())
      .filter((n) => n.userId === userId && n.status !== "DELETED")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** Update a note in-place. Caller must verify ownership. */
  update(note, fields) {
    const ts = now();
    Object.assign(note, fields, { updatedAt: ts });
    markDirty("notes", note.noteId);
    return note;
  },

  /** Soft-delete a note (mark as DELETED). */
  delete(noteId) {
    const note = _notes.get(noteId);
    if (note) {
      const ts = now();
      note.status = "DELETED";
      note.deletedAt = ts;
      note.updatedAt = ts;
      markDirty("notes", noteId);
    }
  },
};

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

export const Concurrency = {
  /** Simple in-memory lock for dev. Production uses Apps Script LockService. */
  _locks: new Map(),

  /**
   * Acquire a named lock. Executes fn while holding the lock.
   * In dev, uses a simple Map-based lock (single-process safe).
   * In production, uses Apps Script LockService with timeout.
   */
  async withLock(name, fn) {
    // For dev, since we're single-process, we can just execute directly.
    // In production, this would use Apps Script LockService.getScriptLock()
    // or a distributed lock via Apps Script Properties.
    return fn();
  },

  /**
   * Check for duplicate user by Google subject.
   * Returns true if duplicate exists (should not happen in normal flow).
   */
  isDuplicateUser(googleSub) {
    return _users.has(googleSub);
  },

  /**
   * Check for duplicate active COR record for a user.
   * Returns the existing record if found, null otherwise.
   */
  getDuplicateCorRecord(userId) {
    return CorRecords.getActiveByUserId(userId);
  },
};

// ---------------------------------------------------------------------------
// Academic catalog repositories (seeded from academic-catalog.json)
// ---------------------------------------------------------------------------

const _campuses = new Map();
const _departments = new Map();
const _programs = new Map();
const _terms = new Map();
const _subjects = new Map();
const _catalogBuildings = new Map();
const _catalogRooms = new Map();

/** Normalize a catalog row to include provenance metadata. */
function catalogRow(row, source) {
  return { ...row, _source: source || "SEED", _seededAt: now() };
}

export const Campuses = {
  getAll() { return Array.from(_campuses.values()); },
  getById(campusId) { return _campuses.get(campusId) || null; },
  getActive() { return Array.from(_campuses.values()).filter((c) => c.status === "ACTIVE"); },
  getByCode(code) {
    for (const c of _campuses.values()) {
      if (c.campusCode === code) return c;
    }
    return null;
  },
  seed(rows) { for (const r of rows) _campuses.set(r.campusId, catalogRow(r, "SEED")); },
};

export const Departments = {
  getAll() { return Array.from(_departments.values()); },
  getById(departmentId) { return _departments.get(departmentId) || null; },
  getActive() { return Array.from(_departments.values()).filter((d) => d.status === "ACTIVE"); },
  getByCode(code) {
    for (const d of _departments.values()) {
      if (d.departmentCode === code) return d;
    }
    return null;
  },
  seed(rows) { for (const r of rows) _departments.set(r.departmentId, catalogRow(r, "SEED")); },
};

export const Programs = {
  getAll() { return Array.from(_programs.values()); },
  getById(programId) { return _programs.get(programId) || null; },
  getActive() { return Array.from(_programs.values()).filter((p) => p.status === "ACTIVE"); },
  getByCode(code) {
    for (const p of _programs.values()) {
      if (p.programCode === code) return p;
    }
    return null;
  },
  getByDepartmentId(departmentId) {
    return Array.from(_programs.values()).filter((p) => p.departmentId === departmentId);
  },
  seed(rows) { for (const r of rows) _programs.set(r.programId, catalogRow(r, "SEED")); },
};

export const Terms = {
  getAll() { return Array.from(_terms.values()); },
  getById(termId) { return _terms.get(termId) || null; },
  getActive() { return Array.from(_terms.values()).filter((t) => t.status === "ACTIVE"); },
  getCurrent() {
    const now_ = new Date();
    for (const t of _terms.values()) {
      if (t.status === "ACTIVE" && t.startsOn && t.endsOn) {
        const start = new Date(t.startsOn);
        const end = new Date(t.endsOn);
        if (now_ >= start && now_ <= end) return t;
      }
    }
    // Fallback: most recent ACTIVE term
    return this.getActive().sort((a, b) => (b.startsOn || "").localeCompare(a.startsOn || ""))[0] || null;
  },
  getByCode(termCode) {
    for (const t of _terms.values()) {
      if (t.termCode === termCode) return t;
    }
    return null;
  },
  seed(rows) { for (const r of rows) _terms.set(r.termId, catalogRow(r, "SEED")); },
};

export const Subjects = {
  getAll() { return Array.from(_subjects.values()); },
  getById(subjectId) { return _subjects.get(subjectId) || null; },
  getActive() { return Array.from(_subjects.values()).filter((s) => s.status === "ACTIVE"); },
  getByCode(code) {
    for (const s of _subjects.values()) {
      if (s.subjectCode === code) return s;
    }
    return null;
  },
  getByDepartmentId(departmentId) {
    return Array.from(_subjects.values()).filter((s) => s.departmentId === departmentId);
  },
  seed(rows) { for (const r of rows) _subjects.set(r.subjectId, catalogRow(r, "SEED")); },
};

export const CatalogBuildings = {
  getAll() { return Array.from(_catalogBuildings.values()); },
  getById(buildingId) { return _catalogBuildings.get(buildingId) || null; },
  getActive() { return Array.from(_catalogBuildings.values()).filter((b) => b.status === "ACTIVE"); },
  getByCampusId(campusId) {
    return Array.from(_catalogBuildings.values()).filter((b) => b.campusId === campusId);
  },
  getByCode(code) {
    for (const b of _catalogBuildings.values()) {
      if (b.buildingCode === code) return b;
    }
    return null;
  },
  seed(rows) { for (const r of rows) _catalogBuildings.set(r.buildingId, catalogRow(r, "SEED")); },
};

export const CatalogRooms = {
  getAll() { return Array.from(_catalogRooms.values()); },
  getById(roomId) { return _catalogRooms.get(roomId) || null; },
  getActive() { return Array.from(_catalogRooms.values()).filter((r) => r.status === "ACTIVE"); },
  getByBuildingId(buildingId) {
    return Array.from(_catalogRooms.values()).filter((r) => r.buildingId === buildingId);
  },
  getByCode(buildingId, roomCode) {
    for (const r of _catalogRooms.values()) {
      if (r.buildingId === buildingId && r.roomCode === roomCode) return r;
    }
    return null;
  },
  seed(rows) { for (const r of rows) _catalogRooms.set(r.roomId, catalogRow(r, "SEED")); },
};

// ---------------------------------------------------------------------------
// Catalog seed loader — reads academic-catalog.json and populates maps
// ---------------------------------------------------------------------------

export const CatalogSeed = {
  /** Load catalog from a parsed JSON object. */
  load(catalog) {
    if (catalog.campuses) Campuses.seed(catalog.campuses);
    if (catalog.departments) Departments.seed(catalog.departments);
    if (catalog.programs) Programs.seed(catalog.programs);
    if (catalog.terms) Terms.seed(catalog.terms);
    if (catalog.subjects) Subjects.seed(catalog.subjects);
    if (catalog.buildings) CatalogBuildings.seed(catalog.buildings);
    if (catalog.rooms) CatalogRooms.seed(catalog.rooms);
  },

  /** Get catalog metadata (version, counts). */
  meta() {
    return {
      version: 1,
      campuses: _campuses.size,
      departments: _departments.size,
      programs: _programs.size,
      terms: _terms.size,
      subjects: _subjects.size,
      buildings: _catalogBuildings.size,
      rooms: _catalogRooms.size,
    };
  },

  /** Check if catalog is loaded (any entity present). */
  isLoaded() {
    return _campuses.size > 0;
  },
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Auto-load embedded catalog on module init.
// This ensures Cloudflare Pages Functions have access to academic data
// (buildings, programs, terms, subjects) without needing filesystem access.
// The dev-server also calls CatalogSeed.load() explicitly, but this covers
// the production case where the dev-server script never runs.
// ---------------------------------------------------------------------------
import embeddedCatalog from "./catalog-seed.js";
if (!CatalogSeed.isLoaded()) {
  CatalogSeed.load(embeddedCatalog);
}

// ---------------------------------------------------------------------------
// Migration / reset (dev only)
// ---------------------------------------------------------------------------

export const DevReset = {
  /** Clear all in-memory data. For development/testing only. */
  clearAll() {
    clearUserData();
  },

  /** Clear only catalog data (academic reference data). */
  clearCatalog() {
    _campuses.clear();
    _departments.clear();
    _programs.clear();
    _terms.clear();
    _subjects.clear();
    _catalogBuildings.clear();
    _catalogRooms.clear();
  },

  /** Get counts of all entities. */
  counts() {
    return {
      users: _users.size,
      corRecords: _corRecords.size,
      corFiles: _corFiles.size,
      corDrafts: _corDrafts.size,
      profiles: _profiles.size,
      enrollments: _enrollments.size,
      enrollmentSubjects: _enrollmentSubjects.size,
      schedules: _schedules.size,
      scheduleEntries: _scheduleEntries.size,
      tasks: _tasks.size,
      notes: _notes.size,
      campuses: _campuses.size,
      departments: _departments.size,
      programs: _programs.size,
      terms: _terms.size,
      subjects: _subjects.size,
      catalogBuildings: _catalogBuildings.size,
      catalogRooms: _catalogRooms.size,
      pendingWrites: _dirty.size,
    };
  },
};
