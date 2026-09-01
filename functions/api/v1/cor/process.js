// POST /api/v1/cor/process
// Triggers extraction processing for an uploaded COR.
// Dev-only: runs a mock extraction that produces synthetic results.

import {
  readPlatformSession,
  getUserByGoogleSub,
  json,
} from "../../auth/_lib.js";
import { CorRecords, CorDrafts, CorFiles } from "../../repo/index.js";

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"];

async function extractWithGemini(imageBytes, mimeType, apiKey) {
  const base64 = Buffer.from(imageBytes).toString("base64");
  
  const prompt = `Extract ALL information from this QCU (Quezon City University) Certificate of Registration from the San Bartolome campus. Return ONLY valid JSON.

QCU SB Building Codes (use these to decode room codes):
IA = TechVoc
IB = Yellow Building (Old Academic Building)
IC = SB (Belmonte Hall)
ID = Admin Building
IE = Metal Casting
IF = KorPhil
IG = PhilChi
IH = Chem Lab
IJ = Canteen
IK = Auditorium (Bautista Building)
IL = New Academic Building

Room code format: BuildingCode + Floor + RoomNumber
Examples: IL502A = New Academic Building, 5th Floor, Room 2A
          IA203 = TechVoc, 2nd Floor, Room 03
          IK603 F1 = Bautista, 6th Floor, Room 03, Lab F1
          SB OG = SB Open Grounds

Return this JSON structure:
{
  "studentNumber": "string or null",
  "firstName": "string or null",
  "middleName": "string or null",
  "lastName": "string or null",
  "program": "full program name or null",
  "programCode": "short code like BSCS, BSIT or null",
  "campus": "string or null",
  "yearLevel": number or null,
  "section": "string or null",
  "semester": number or null,
  "academicYear": "string like 2026-2027 or null",
  "studentStatus": "Regular or Irregular or null",
  "subjects": [
    {
      "code": "subject code like CC102, MATH 1, PE 1",
      "name": "full subject name",
      "units": number,
      "room": "room code like IL502A",
      "buildingCode": "2-letter code like IL, IA, IK",
      "buildingName": "full building name like New Academic Building",
      "floor": number or null,
      "roomNumber": "room number like 02A",
      "days": "day codes like M, W, TH, F",
      "startTime": "time like 8:00AM",
      "endTime": "time like 10:00AM",
      "section": "class section"
    }
  ],
  "totalUnits": number,
  "adviserName": "string or null"
}

Rules:
- Extract EXACTLY what you see in the image
- For room codes, parse the building code and look up the building name from the list above
- For days use single letters: M=Monday, T=Tuesday, W=Wednesday, TH=Thursday, F=Friday, S=Saturday
- For times keep original format like 8:00AM
- If a field is not readable, use null
- If same subject has multiple rows (lecture + lab), include BOTH
- Return ONLY the JSON, no markdown`;
  let lastError = null;
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const response = await fetch(`${url}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini ${model} HTTP ${response.status}:`, errText.slice(0, 300));
        lastError = `${model}: HTTP ${response.status} - ${errText.slice(0, 100)}`;
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = `${model}: No JSON in response`;
        continue;
      }
      console.log("Gemini model", model, "succeeded");
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error(`Gemini ${model} error:`, err.message);
      lastError = `${model}: ${err.message}`;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

function geminiResultToDraft(result) {
  // Map short day codes to full day names (confirm.js expects strings like "Monday")
  const dayNameMap = { M: "Monday", T: "Tuesday", W: "Wednesday", TH: "Thursday", F: "Friday", S: "Saturday", SU: "Sunday" };

  // Convert 12h time like "11:30AM" to 24h "11:30"
  function to24h(t) {
    if (!t) return null;
    const m = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (!m) return null;
    let h = parseInt(m[1]);
    const min = m[2];
    const mer = (m[3] || "").toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return String(h).padStart(2, "0") + ":" + min;
  }

  const subjects = (result.subjects || []).map(s => {
    const schedule = [];
    if (s.days && s.startTime && s.endTime) {
      const dayChars = s.days.replace(/[^A-Za-z]/g, "").match(/[A-Z]{1,2}/g) || [];
      for (const dc of dayChars) {
        const dayName = dayNameMap[dc.toUpperCase()];
        if (dayName) {
          schedule.push({
            day: { value: dayName, sourceText: s.days, confidence: 0.90 },
            time: {
              start: to24h(s.startTime),
              end: to24h(s.endTime),
              sourceText: s.startTime + " - " + s.endTime,
              confidence: 0.85,
            },
          });
        }
      }
    }
    // Use Gemini's parsed building info, or fall back to room code parsing
    const buildingCode = s.buildingCode || null;
    const buildingName = s.buildingName || null;
    const floor = s.floor || null;
    const roomNumber = s.roomNumber || null;
    return {
      subjectCode: { value: s.code || null, sourceText: s.code || "", confidence: s.code ? 0.90 : 0 },
      subjectName: { value: s.name || null, sourceText: s.name || "", confidence: s.name ? 0.85 : 0 },
      units: { value: s.units || null, sourceText: String(s.units || ""), confidence: s.units ? 0.90 : 0 },
      schedule,
      room: s.room ? {
        value: s.room,
        sourceText: s.room,
        confidence: 0.80,
        buildingCode,
        buildingName,
        floor,
        roomNumber,
      } : null,
    };
  });

  return {
    studentInfo: {
      studentNumber: result.studentNumber ? { value: result.studentNumber, sourceText: result.studentNumber, confidence: 0.95 } : null,
      firstName: result.firstName ? { value: result.firstName, sourceText: result.firstName, confidence: 0.90 } : null,
      middleName: result.middleName ? { value: result.middleName, sourceText: result.middleName, confidence: 0.85 } : null,
      lastName: result.lastName ? { value: result.lastName, sourceText: result.lastName, confidence: 0.90 } : null,
      suffix: null,
    },
    enrollmentInfo: {
      program: result.program ? { value: result.program, sourceText: result.program, confidence: 0.90 } : null,
      programCode: result.programCode || null,
      campus: result.campus ? { value: result.campus, sourceText: result.campus, confidence: 0.90 } : null,
      yearLevel: result.yearLevel ? { value: result.yearLevel, sourceText: String(result.yearLevel), confidence: 0.90 } : null,
      section: result.section ? { value: result.section, sourceText: result.section, confidence: 0.85 } : null,
      term: result.semester ? { value: "Semester " + result.semester, sourceText: String(result.semester), confidence: 0.85 } : null,
      academicYear: result.academicYear ? { value: result.academicYear, sourceText: result.academicYear, confidence: 0.90 } : null,
      studentStatus: result.studentStatus ? { value: result.studentStatus.toUpperCase(), sourceText: result.studentStatus, confidence: 0.85 } : null,
      adviserName: result.adviserName || null,
    },
    subjects,
    totalUnits: result.totalUnits || subjects.reduce((sum, s) => sum + (s.units?.value || 0), 0),
    validationIssues: [],
    pipelineVersion: "gemini-flash-1",
    extractionSchemaVersion: "1",
  };
}


// ---------------------------------------------------------------------------
// Day/time parsing helpers
// ---------------------------------------------------------------------------
const DAY_MAP = {
  mon: 1, monday: 1, m: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3, w: 3,
  thu: 4, thur: 4, thursday: 4, thurs: 4, r: 4,
  fri: 5, friday: 5, f: 5,
  sat: 6, saturday: 6, s: 6,
  sun: 7, sunday: 7,
};

function parseDays(text) {
  if (!text) return [];
  const t = text.toLowerCase().replace(/[^a-z/\s]/g, "").trim();
  const days = [];
  // Try full words first
  for (const [key, val] of Object.entries(DAY_MAP)) {
    if (key.length > 2 && t.includes(key) && !days.includes(val)) days.push(val);
  }
  if (days.length > 0) return days.sort();
  // Try single letters: M W F or T Th
  const parts = t.split(/[\s/,]+/).filter(Boolean);
  for (const p of parts) {
    if (DAY_MAP[p] && !days.includes(DAY_MAP[p])) days.push(DAY_MAP[p]);
  }
  return days.sort();
}

function parseTime12h(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2];
  const meridiem = m[3];
  if (meridiem) {
    const lower = meridiem.toLowerCase();
    if (lower === "pm" && h < 12) h += 12;
    if (lower === "am" && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${min}`;
}

function parseTimeRange(text) {
  if (!text) return null;
  // Patterns: 8:00-9:30, 8:00 AM - 9:30 AM, 13:00-14:30
  const m = text.match(/(\d{1,2}(:\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(:\d{2})?\s*(?:am|pm)?)/i);
  if (!m) return null;
  const start = parseTime12h(m[1]);
  const end = parseTime12h(m[3]);
  return start && end ? { start, end } : null;
}

// ---------------------------------------------------------------------------
// COR text parser — extracts structured data from OCR text
// ---------------------------------------------------------------------------
function parseCorText(text, googleName) {
  // Normalize: collapse whitespace, fix common OCR errors
  const normalized = text
    .replace(/[\r]+/g, "")
    .replace(/\t+/g, " ")
    .replace(/  +/g, " ");
  const lines = normalized.split("\n").map((l) => l.trim());
  const fullText = lines.join("\n");

  // --- Campus ---
  const campus = fullText.match(/Campus:\s*([A-Za-z\s]+?)(?:\n|AY:|CERTIFICATE)/i)?.[1]?.trim()
    || fullText.match(/(San\s+Bartolome|Commonwealth|San\s+Francisco)/i)?.[1]
    || null;

  // --- Academic Year ---
  const acadYear = fullText.match(/AY[:\s]*((\d{4})\s*[-–]\s*(\d{4}))/i)?.[1]?.trim()
    || fullText.match(/(\d{4})\s*[-–]\s*(\d{4})/)?.[0]
    || null;

  // --- Semester ---
  const semRaw = fullText.match(/SEM[:\s]*(\d(?:st|nd|rd|th)?)/i)?.[1]
    || fullText.match(/Semester[:\s]*(\d)/i)?.[1]
    || null;
  const semester = semRaw ? semRaw.replace(/\D/g, "") : null;

  // --- Student Number ---
  const studentNumber = fullText.match(/Stud\s*No[:\s]*([\d-]+)/i)?.[1]
    || fullText.match(/(?:student\s*no|stud\s*no|id\s*no)[:\s]*([\w-]+)/i)?.[1]
    || null;

  // --- Course/Year/Section line (QCU format: "1st YrSBCS1B") ---
  const cysLine = fullText.match(/Course\/Year\/Section[:\s]*(.+)/i)?.[1] || "";
  let yearLevel = null;
  let programCode = null;
  let section = null;

  // Parse "1st YrSBCS1B" or "2nd Yr BSIT 2A"
  const yrMatch = cysLine.match(/(\d)(?:st|nd|rd|th)?\s*(?:Yr|Year)/i);
  if (yrMatch) yearLevel = parseInt(yrMatch[1]);

  // Program code: 2-4 letter code after year
  const progMatch = cysLine.match(/(?:Yr|Year)\s*([A-Z]{2,5})\s*(?:\d|[A-Z]|$)/i)
    || cysLine.match(/\b(BSCS|BSIT|BSBA|BEED|BSED|BSN|BSEE|BSA|BSAIS|BSOA|BSTM|BSHM|BSCE|BSCPE|BSME|BSArch)\b/i);
  if (progMatch) programCode = progMatch[1].toUpperCase();

  // Section: letters/digits after program code
  const secMatch = cysLine.match(/(?:Yr|Year)\s*[A-Z]{2,5}\s*([A-Z]?\d+[A-Z]?)/i)
    || cysLine.match(/([A-Z]?\d+[A-Z])/);
  if (secMatch) section = secMatch[1].trim();

  // Fallback: try the raw line
  if (!programCode) {
    const altProg = fullText.match(/\b(BSCS|BSIT|BSBA|BEED|BSED|BSN|BSEE)\b/i);
    if (altProg) programCode = altProg[1].toUpperCase();
  }
  if (!yearLevel) {
    const altYr = fullText.match(/(\d)(?:st|nd|rd|th)?\s*Yr/i);
    if (altYr) yearLevel = parseInt(altYr[1]);
  }

  // --- Student Status ---
  const studentStatus = fullText.match(/(Regular|Irregular|Transferee|Returning)/i)?.[1] || null;

  // --- Adviser ---
  const adviserName = fullText.match(/ADVISER[^(]*\((?:Full\s*)?Signature\)?[^\n]*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i)?.[1]
    || fullText.match(/(?:adviser|advisor)[:\s]+([A-Za-z\s.,]+?)(?:\n|$)/i)?.[1]?.trim()
    || null;

  // --- Subjects: scan for schedule table rows ---
  const subjects = [];
  const seenCodes = new Set();

  // QCU COR table has columns: Code | Section | Subject | Units | Room | Days | Time | Professor
  // Try to find rows that look like schedule entries
  const subjectPatterns = [
    // Pattern 1: CC 104 or MATH 104 (code with space)
    /^([A-Z]{1,6})\s+(\d{1,4})\b/,
    // Pattern 2: CC104 (no space)
    /^([A-Z]{1,6})(\d{2,4})\b/,
  ];

  const dayTokens = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Tues|Thurs|M|T|W|Th|R|F|S)\b/gi;
  const timeTokens = /(\d{1,2}):?(\d{2})\s*(AM|PM|am|pm)?/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip header/footer lines
    if (/^(QUEZON|CERTIFICATE|Code\s+Section|Subject\s+uni|Student\s+Handbook|IMPORTANT|Keep this|By:\s|Date:| Fees |CHED|Dect Reger)/i.test(line)) continue;
    if (line.length < 5) continue;

    let code = null;
    let subjectCode = null;
    for (const pat of subjectPatterns) {
      const m = line.match(pat);
      if (m) {
        code = m[0];
        subjectCode = `${m[1]} ${m[2]}`;
        break;
      }
    }
    if (!subjectCode) continue;

    // Skip duplicates and known non-subject codes
    const codeKey = subjectCode.toUpperCase().replace(/\s+/g, " ");
    if (seenCodes.has(codeKey)) continue;
    if (/^(CT CE|CC I|CC 1|I TS|C0|CO|ET|EE)/i.test(codeKey)) continue;

    // Try to find subject name (uppercase text between code and numeric/pipe)
    const afterCode = line.slice(line.indexOf(code) + code.length);
    let subjectName = afterCode.match(/\|?\s*([A-Z][A-Z\s&.()-]{3,})/)?.[1]?.trim() || null;
    if (subjectName) {
      // Clean: remove trailing pipes, numbers, day names
      subjectName = subjectName
        .split(/\|/)[0]
        .split(/\d{1,2}:?\d{0,2}/)[0]
        .split(/\b(Mon|Tue|Wed|Thu|Fri)\b/i)[0]
        .trim();
      if (subjectName.length < 3) subjectName = null;
    }

    // Units: number near "unit" or standalone small number
    const units = line.match(/(\d{1,2}(?:\.\d)?)\s*(?:unit|cr|cred)/i)?.[1]
      || line.match(/[|]\s*(\d{1,2}(?:\.\d)?)\s*[|]/)?.[1]
      || null;

    // Days and times
    const meetings = [];
    const dayMatches = [...line.matchAll(dayTokens)];
    const timeMatches = [...line.matchAll(timeTokens)];

    if (dayMatches.length > 0 && timeMatches.length >= 2) {
      const days = [];
      for (const dm of dayMatches) {
        const parsed = parseDays(dm[0]);
        days.push(...parsed);
      }
      const uniqueDays = [...new Set(days)].sort();

      // Pair up start/end times
      const times = timeMatches.map((tm) => {
        let h = parseInt(tm[1]);
        const min = tm[2].padStart(2, "0");
        const mer = tm[3]?.toLowerCase();
        if (mer === "pm" && h < 12) h += 12;
        if (mer === "am" && h === 12) h = 0;
        return `${String(h).padStart(2, "0")}:${min}`;
      });

      for (const d of uniqueDays) {
        if (times.length >= 2) {
          meetings.push({
            dayOfWeek: { value: d, sourceText: dayMatches.map((m) => m[0]).join(" "), confidence: 0.80 },
            startTime: { value: times[0], sourceText: timeMatches.map((m) => m[0]).join(" "), confidence: 0.75 },
            endTime: { value: times[1], sourceText: timeMatches.map((m) => m[0]).join(" "), confidence: 0.75 },
          });
        }
      }
    }

    // Room
    const room = line.match(/\b(IL\d+[A-Z]?|IK\d+[A-Z\s]*|RM\s*\d+|SB\s*\w+|Room\s*\w+)/i)?.[1]?.trim()
      || line.match(/(?:room|rms?)[:\s]*([\w\s.-]+)/i)?.[1]?.trim()
      || null;

    subjects.push({
      subjectCode: { value: code, sourceText: code, confidence: 0.90 },
      subjectName: { value: subjectName, sourceText: subjectName, confidence: 0.85 },
      units: { value: units, sourceText: String(units ?? ''), confidence: units ? 0.90 : 0 },
      meetings,
      room: room ? { value: room, sourceText: room, confidence: 0.85 } : null,
    });
  }

  // Fallback: look for readable subject names (e.g. "Athletics & Sports Dev.")
  if (subjects.length === 0 || true) {
    const subjectNamePattern = /^([A-Z][A-Za-z\s&.()-]{5,40})\s*$/;
    const unitPattern = /(\d{1,2})\s*(?:unit|cr|cred|Unit)/i;
    for (const line of lines) {
      const nameMatch = line.match(subjectNamePattern);
      if (!nameMatch) continue;
      const name = nameMatch[1].trim();
      if (/^(QUEZON|CERTIFICATE|Certificate|IMPORTANT|Keep|ADVISER|Students Signature|University|College|Campus|Formerly|Student Handbook|Student Welfare|Regular Student|Irregular Student|Graduating|Enrollment|Semester|School Year|Previous|Tuition|Fees|Total|CHED-UnIFAST|Php|Code Section|Dect|Office|FICE)/i.test(name)) continue;
      if (name.length < 5) continue;
      const codeKey = name.toUpperCase();
      if (seenCodes.has(codeKey)) continue;
      seenCodes.add(codeKey);
      subjects.push({
        subjectCode: { value: null, sourceText: null, confidence: 0 },
        subjectName: { value: name, sourceText: name, confidence: 0.60 },
        units: { value: null, sourceText: null, confidence: 0 },
        meetings: [],
        room: null,
      });
    }
  }

  // --- Find name: try OCR first, then Google fallback ---
  let firstName = null, middleName = null, lastName = null;
  let nameSource = "manual";

  // Try 1: OCR name extraction - look for text near (Family/Given/Middle Name) labels
  const nameLabelIdx = fullText.indexOf("Family Name"); 
  if (nameLabelIdx > -1) {
    // Get text around the name labels (100 chars before and after)
    const nameRegion = fullText.substring(Math.max(0, nameLabelIdx - 100), nameLabelIdx + 200);
    // QCU COR format: name is typically printed ABOVE the labels
    // Look for capitalized words that look like names
    const possibleNames = nameRegion.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g) || [];
    // Filter out known non-name words
    const nonNames = /^(The|This|That|New|Old|From|Last|First|Family|Given|Middle|Name|Course|Year|Section|Regular|Irregular|Student|Graduating|Enrollment|Semester|School|Previous|University|Athletics|Sports|Development|Code|Subject|Unit|Room|Days|Time|Professor|University|Certificate|Registration|Quezon|City)$/i;
    const cleanNames = possibleNames.filter(n => !nonNames.test(n.trim()));
    if (cleanNames.length > 0) {
      // Take the first clean name found
      const rawName = cleanNames[0].trim();
      const parts = rawName.split(/\s+/);
      if (parts.length >= 3) {
        lastName = parts[0]; middleName = parts[1]; firstName = parts.slice(2).join(" ");
      } else if (parts.length === 2) {
        firstName = parts[0]; lastName = parts[1];
      }
      if (firstName) nameSource = "ocr";
    }
  }

  // Try 2: Look for name patterns in the full text
  if (!firstName) {
    // Try to find capitalized 2-3 word sequences that look like names
    const namePatterns = fullText.match(/([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})/g) || [];
    for (const np of namePatterns) {
      if (!nonNames?.test(np)) {
        const parts = np.split(/\s+/);
        lastName = parts[0]; middleName = parts[1]; firstName = parts[2];
        nameSource = "ocr-pattern";
        break;
      }
    }
  }

  // Try 3: Google account name as fallback
  if (!firstName && googleName) {
    const nameParts = googleName.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length >= 3) {
      firstName = nameParts[0];
      middleName = nameParts.slice(1, -1).join(" ");
      lastName = nameParts[nameParts.length - 1];
    } else if (nameParts.length === 2) {
      firstName = nameParts[0];
      lastName = nameParts[1];
    } else if (nameParts.length === 1) {
      firstName = nameParts[0];
    }
    if (firstName) nameSource = "google-fallback";
  }
  
  console.log("Name extraction source:", nameSource, "->", firstName, middleName, lastName);

  // Map program code to full name
  const programMap = {
    BSCS: "Bachelor of Science in Computer Science",
    BSIT: "Bachelor of Science in Information Technology",
    BSBA: "Bachelor of Science in Business Administration",
    BEED: "Bachelor of Elementary Education",
    BSED: "Bachelor of Secondary Education",
    BSN: "Bachelor of Science in Nursing",
    BSEE: "Bachelor of Science in Electrical Engineering",
  };

  return {
    studentInfo: {
      studentNumber: studentNumber ? { value: studentNumber, sourceText: studentNumber, confidence: 0.90 } : null,
      firstName: firstName ? { value: firstName, sourceText: "OCR", confidence: 0.60 } : null,
      middleName: middleName ? { value: middleName, sourceText: "OCR", confidence: 0.55 } : null,
      lastName: lastName ? { value: lastName, sourceText: "OCR", confidence: 0.65 } : null,
      suffix: null,
    },
    enrollmentInfo: {
      program: programCode ? { value: programMap[programCode] || programCode, sourceText: programCode, confidence: 0.85, matchedProgramId: `prg_${programCode.toLowerCase()}` } : null,
      campus: campus ? { value: campus, sourceText: campus, confidence: 0.85, matchedCampusId: "cam_sb" } : null,
      yearLevel: yearLevel ? { value: yearLevel, sourceText: String(yearLevel), confidence: 0.85 } : null,
      section: section ? { value: section, sourceText: section, confidence: 0.80 } : null,
      term: semester ? { value: `Semester ${semester}`, sourceText: semRaw, confidence: 0.80 } : null,
      academicYear: acadYear ? { value: acadYear, sourceText: acadYear, confidence: 0.85 } : null,
      studentStatus: studentStatus ? { value: studentStatus.toUpperCase(), sourceText: studentStatus, confidence: 0.80 } : null,
      adviserName,
    },
    subjects,
    totalUnits: subjects.reduce((sum, s) => sum + (s.units?.value || 0), 0),
    rawText: text,
    validationIssues: [],
    pipelineVersion: "tesseract-ocr-2",
    extractionSchemaVersion: "1",
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

    // Must be in ONBOARDING with an active COR record
    if (user.state !== "ONBOARDING" || !user.corRecordId) {
      return json(
        { status: "ERROR", error: "No active COR import to process." },
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

    // Must be in ACCEPTED or QUEUED state
    if (!["ACCEPTED", "QUEUED", "PROCESSING"].includes(record.status)) {
      return json(
        { status: "ERROR", error: `Cannot process COR in state: ${record.status}` },
        400
      );
    }

    // Update record state
    CorRecords.update(record, { status: "PROCESSING" });

    // Get the uploaded file bytes
    const fileData = CorFiles.get(record.id);
    if (!fileData) {
      return json({ status: "ERROR", error: "Could not find uploaded file." }, 404);
    }

    console.log("Processing COR:", record.filename, "(", fileData.mimeType, ")...");

    // Try Gemini first, fall back to Tesseract
    const geminiKey = (context.env || {}).GEMINI_API_KEY;
    let extractionResult = null;

    if (geminiKey) {
      console.log("Using Gemini Vision API, key starts with:", geminiKey.slice(0, 6) + "...");
      try {
        const geminiResult = await extractWithGemini(fileData.bytes, fileData.mimeType, geminiKey);
        extractionResult = geminiResultToDraft(geminiResult);
        console.log("Gemini OK:", extractionResult.subjects.length, "subjects,", extractionResult.studentInfo.firstName?.value, extractionResult.studentInfo.lastName?.value);
      } catch (geminiError) {
        console.error("Gemini FAILED:", geminiError.message);
        return json({ status: "ERROR", error: `Gemini error: ${geminiError.message}` }, 500);
      }
    } else {
      console.log("No GEMINI_API_KEY found, skipping Gemini");
    }

    if (!extractionResult) {
      const msg = !geminiKey
        ? "No GEMINI_API_KEY set. COR processing requires a valid Gemini API key from https://aistudio.google.com/apikey"
        : `Gemini extraction failed. Your key starts with: ${geminiKey.slice(0, 6)}... Error: Check Cloudflare Functions logs.`;
      return json({ status: "ERROR", error: msg }, 500);
    }

    // Store draft
    CorDrafts.set(record.id, extractionResult);

    // Update record to REVIEW_REQUIRED
    CorRecords.update(record, { status: "REVIEW_REQUIRED", draftVersion: 1 });

    return json({
      status: "REVIEW_REQUIRED",
      corRecordId: record.id,
      message: "Extraction complete. Please review your information.",
      subjectsFound: extractionResult.subjects.length,
      totalUnits: extractionResult.totalUnits,
    });
  } catch (error) {
    console.error("COR processing failed:", String(error?.message || error));
    return json(
      { status: "ERROR", error: "Failed to process COR. Please try again." },
      500
    );
  }
}
