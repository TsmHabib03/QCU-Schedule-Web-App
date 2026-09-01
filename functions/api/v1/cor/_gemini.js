// Shared Gemini extraction functions for COR processing.
// Used by both upload.js (immediate extraction) and process.js (on-demand).

export const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"];

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

export function geminiResultToDraft(result) {
  const dayNameMap = { M: "Monday", T: "Tuesday", W: "Wednesday", TH: "Thursday", F: "Friday", S: "Saturday", SU: "Sunday" };

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
