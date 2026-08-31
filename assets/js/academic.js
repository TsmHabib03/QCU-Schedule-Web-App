/**
 * academic.js — Frontend API helper for QCU academic catalog.
 *
 * Fetches campus, department, program, term, subject, building,
 * and room data from the public catalog API. Caches results in
 * sessionStorage with a 5-minute TTL to avoid repeated fetches.
 *
 * Usage:
 *   const academic = await AcademicCatalog.init();
 *   const campus   = academic.resolveCampus("cam_sb");
 *   const dept     = academic.resolveDepartment("dep_ccs");
 *   const program  = academic.resolveProgram("prg_bscs");
 *   const term     = academic.getCurrentTerm();
 *   const subject  = academic.resolveSubject("sub_cc101");
 *   const building = academic.resolveBuilding("bldg_new_academic");
 *   const room     = academic.resolveRoom("rm_il502a");
 *
 *   // Branding chain: enrollment → program → department → display
 *   const branding = academic.resolveBranding(enrollment);
 */

const AcademicCatalog = (() => {
  "use strict";

  const CACHE_PREFIX = "qcu_cat_";
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  let _campuses = [];
  let _departments = [];
  let _programs = [];
  let _terms = [];
  let _subjects = [];
  let _buildings = [];
  let _rooms = [];

  let _campusMap = new Map();
  let _deptMap = new Map();
  let _programMap = new Map();
  let _termMap = new Map();
  let _subjectMap = new Map();
  let _buildingMap = new Map();
  let _roomMap = new Map();

  let _programByCode = new Map();
  let _deptByCode = new Map();
  let _subjectByCode = new Map();
  let _buildingByCode = new Map();

  function cacheKey(name) { return CACHE_PREFIX + name; }

  function getCache(name) {
    try {
      const raw = sessionStorage.getItem(cacheKey(name));
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem(cacheKey(name)); return null; }
      return data;
    } catch { return null; }
  }

  function setCache(name, data) {
    try { sessionStorage.setItem(cacheKey(name), JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  async function fetchCatalog(name) {
    const cached = getCache(name);
    if (cached) return cached;
    try {
      const r = await fetch(`/api/v1/academic/${name}`, { cache: "no-store" });
      if (!r.ok) return [];
      const d = await r.json();
      const arr = d[name] || d[`${name}s`] || [];
      setCache(name, arr);
      return arr;
    } catch { return []; }
  }

  function buildMaps() {
    _campusMap = new Map(_campuses.map(c => [c.campusId, c]));
    _deptMap = new Map(_departments.map(d => [d.departmentId, d]));
    _programMap = new Map(_programs.map(p => [p.programId, p]));
    _termMap = new Map(_terms.map(t => [t.termId, t]));
    _subjectMap = new Map(_subjects.map(s => [s.subjectId, s]));
    _buildingMap = new Map(_buildings.map(b => [b.buildingId, b]));
    _roomMap = new Map(_rooms.map(r => [r.roomId, r]));

    _programByCode = new Map(_programs.map(p => [p.programCode, p]));
    _deptByCode = new Map(_departments.map(d => [d.departmentCode, d]));
    _subjectByCode = new Map(_subjects.map(s => [s.subjectCode, s]));
    _buildingByCode = new Map(_buildings.map(b => [b.buildingCode, b]));
  }

  async function init() {
    const [campuses, departments, programs, terms, subjects, buildings, rooms] = await Promise.all([
      fetchCatalog("campuses"),
      fetchCatalog("departments"),
      fetchCatalog("programs"),
      fetchCatalog("terms"),
      fetchCatalog("subjects"),
      fetchCatalog("buildings"),
      fetchCatalog("rooms"),
    ]);
    _campuses = campuses;
    _departments = departments;
    _programs = programs;
    _terms = terms;
    _subjects = subjects;
    _buildings = buildings;
    _rooms = rooms;
    buildMaps();
    return api;
  }

  function invalidate() {
    ["campuses", "departments", "programs", "terms", "subjects", "buildings", "rooms"]
      .forEach(k => sessionStorage.removeItem(cacheKey(k)));
  }

  const api = {
    init,
    invalidate,

    // Raw collections
    get campuses() { return _campuses; },
    get departments() { return _departments; },
    get programs() { return _programs; },
    get terms() { return _terms; },
    get subjects() { return _subjects; },
    get buildings() { return _buildings; },
    get rooms() { return _rooms; },

    // Resolvers by ID
    resolveCampus(id) { return _campusMap.get(id) || null; },
    resolveDepartment(id) { return _deptMap.get(id) || null; },
    resolveProgram(id) { return _programMap.get(id) || null; },
    resolveTerm(id) { return _termMap.get(id) || null; },
    resolveSubject(id) { return _subjectMap.get(id) || null; },
    resolveBuilding(id) { return _buildingMap.get(id) || null; },
    resolveRoom(id) { return _roomMap.get(id) || null; },

    // Resolvers by code
    resolveProgramByCode(code) { return _programByCode.get(code) || null; },
    resolveDepartmentByCode(code) { return _deptByCode.get(code) || null; },
    resolveSubjectByCode(code) { return _subjectByCode.get(code) || null; },
    resolveBuildingByCode(code) { return _buildingByCode.get(code) || null; },

    // Current term
    getCurrentTerm() {
      const now = new Date();
      for (const t of _terms) {
        if (t.status === "ACTIVE" && t.startsOn && t.endsOn) {
          if (now >= new Date(t.startsOn) && now <= new Date(t.endsOn)) return t;
        }
      }
      return _terms.find(t => t.status === "ACTIVE") || _terms[0] || null;
    },

    // Dynamic branding resolution: enrollment → program → department
    resolveBranding(enrollment) {
      if (!enrollment) return { program: null, department: null, campus: null, label: "Student" };

      const program = enrollment.programId ? _programMap.get(enrollment.programId) : null;
      const department = program?.departmentId ? _deptMap.get(program.departmentId) : null;
      const campus = enrollment.campusId ? _campusMap.get(enrollment.campusId) : null;

      return {
        program: program || null,
        department: department || null,
        campus: campus || null,
        label: program?.shortName || department?.shortName || campus?.shortName || "Student",
        collegeName: department?.name || "QCU",
        programName: program?.name || "",
      };
    },

    // Get buildings for a campus
    getBuildingsByCampus(campusId) {
      return _buildings.filter(b => b.campusId === campusId);
    },

    // Get rooms for a building
    getRoomsByBuilding(buildingId) {
      return _rooms.filter(r => r.buildingId === buildingId);
    },

    // Get programs for a department
    getProgramsByDepartment(departmentId) {
      return _programs.filter(p => p.departmentId === departmentId);
    },

    // Get subjects for a department
    getSubjectsByDepartment(departmentId) {
      return _subjects.filter(s => s.departmentId === departmentId);
    },
  };

  return api;
})();

// Make available globally
if (typeof window !== "undefined") window.AcademicCatalog = AcademicCatalog;
