// Shared Gemini extraction functions for COR processing.
// Used by both upload.js (immediate extraction) and process.js (on-demand).
// Model list verified 2026-09: 2.0-flash and 2.5-flash are retired (404 for
// new users) — keep only live models, fastest first.

export const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

export async function extractWithGemini(imageBytes, mimeType, apiKey) {
  let binary = "";
  for (let i = 0; i < imageBytes.length; i++) binary += String.fromCharCode(imageBytes[i]);
  const base64 = btoa(binary);

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
      "timeText": "the class time EXACTLY as printed, e.g. 1:00-2:30 PM or 7:30AM-9:00AM",
      "startTime": "24-hour start time HH:mm, e.g. 13:00; null if the COR does not show AM or PM",
      "endTime": "24-hour end time HH:mm, e.g. 14:30; null if the COR does not show AM or PM",
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
- For timeText copy the time string exactly as printed, keeping the AM/PM marker the COR shows. A COR very often prints the marker ONCE for the whole window ("1:00-2:30 PM") — copy it exactly like that, do not add or move markers
- For startTime/endTime convert to 24-hour HH:mm. When the COR prints AM/PM once for the window, apply it to BOTH times ("1:00-2:30 PM" is 13:00 and 14:30). If the class shows no AM/PM anywhere, set startTime and endTime to null — never guess
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
          // Thinking models spend output tokens on internal reasoning, so the
          // budget must comfortably cover reasoning plus the full COR JSON.
          generationConfig: { temperature: 0.1, maxOutputTokens: 16384 }
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini ${model} HTTP ${response.status}:`, errText.slice(0, 300));
        lastError = `${model}: HTTP ${response.status} - ${errText.slice(0, 100)}`;
        continue;
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      // Thinking models can return several parts; join every text part instead
      // of trusting parts[0] (which may be empty or contain only reasoning).
      const text = (candidate?.content?.parts || [])
        .map(part => part?.text || "")
        .join("")
        .trim();
      const finishReason = candidate?.finishReason;
      if (!text) {
        lastError = `${model}: empty response (${finishReason || "no finish reason"})`;
        console.error(`Gemini ${model} returned no text (${finishReason})`);
        continue;
      }
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = `${model}: No JSON in response (${finishReason || ""})`;
        continue;
      }
      try {
        console.log("Gemini model", model, "succeeded");
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        // Truncated JSON (MAX_TOKENS mid-object) — fall through to next model
        // instead of crashing the whole extraction loop.
        lastError = `${model}: truncated JSON (${finishReason || "parse error"})`;
        console.error(`Gemini ${model}: JSON parse failed (${finishReason})`);
      }
    } catch (err) {
      console.error(`Gemini ${model} error:`, err.message);
      lastError = `${model}: ${err.message}`;
    }
  }
  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

import { parseDayTokens, readTimeRange, splitTimeRangeText } from "../../_lib/day-time.js";
export { parseDayTokens as parseDays };

export function geminiResultToDraft(result) {

  const issues = [];
  const rawSubjects = Array.isArray(result.subjects) ? result.subjects : [];

  const subjects = rawSubjects.map((s, index) => {
    const schedule = [];
    const label = s.code || s.name || `Subject ${index + 1}`;
    const days = parseDayTokens(s.days);

    // The class window is read from the text the COR prints — the model
    // transcribes, this parser decides what the times mean. A model that
    // "helpfully" resolves a shared marker on its own is not trusted with the
    // one thing a wrong answer ruins (the class lands at 1 AM); its 24-hour
    // fields are the fallback for when it did not transcribe the text.
    const printedTime = String(s.timeText || [s.startTime, s.endTime].filter(Boolean).join(" - ")).trim();
    const fromText = s.timeText ? readTimeRange(...splitTimeRangeText(s.timeText)) : null;
    const fromFields = readTimeRange(s.startTime, s.endTime);
    const window = fromText && !fromText.unresolved ? fromText : fromFields;
    const readable = Boolean(window && !window.unresolved && window.start && window.end);

    if (days.length) {
      for (const dayName of days) {
        schedule.push({
          day: { value: dayName, sourceText: s.days, confidence: 0.90 },
          // No readable window: the meeting is kept WITHOUT a time and the
          // review step asks. An hour nobody can read off the page must never be
          // invented — "1:00-2:30" is not 1:00 AM just because classes are often
          // in the morning. See the Times rules in COR_AI_PIPELINE.md.
          time: readable
            ? { start: window.start, end: window.end, sourceText: window.sourceText || printedTime, confidence: 0.85 }
            : { start: null, end: null, sourceText: printedTime, unresolved: true, confidence: 0 },
        });
      }
    }

    // Anything unreadable must not silently disappear: it is reported as a
    // validation issue so the review step can ask for a fix instead of the app
    // quietly creating classes with no time or on the wrong day.
    if (!days.length) {
      const what = !s.days ? "the day and the time could not be read" : "no valid day was found";
      issues.push({
        field: `subjects[${index}].schedule`,
        message: `${label}: ${what}. Set it in Schedule after importing, or upload a clearer photo of the COR.`,
      });
    } else if (!readable) {
      const what = printedTime
        ? `the AM/PM marker could not be read (saw "${printedTime}"), so the time was left unset`
        : "the time could not be read, so it was left unset";
      issues.push({
        field: `subjects[${index}].schedule`,
        message: `${label}: ${what}. Choose the time here or in Schedule after importing.`,
      });
    }

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
    validationIssues: issues,
    pipelineVersion: "gemini-flash-1",
    extractionSchemaVersion: "1",
  };
}
