import { GMAIL_SCOPE, googleJson, hasScope, json, sessionHeader, validSession } from "./_lib.js";

const CLASSROOM = "https://classroom.googleapis.com/v1";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

function timeValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value, max = 320) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function courseUrl(course, alternateLink) {
  return alternateLink || course.alternateLink || `https://classroom.google.com/c/${encodeURIComponent(course.id)}`;
}

function dueAt(item) {
  if (!item.dueDate) return null;
  const date = item.dueDate;
  const time = item.dueTime || {};
  const iso = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}T${String(time.hours || 23).padStart(2, "0")}:${String(time.minutes || 59).padStart(2, "0")}:00+08:00`;
  return new Date(iso).toISOString();
}

function materialKind(materials) {
  const first = Array.isArray(materials) ? materials[0] : null;
  if (!first) return "Resource";
  if (first.driveFile) return first.driveFile.driveFile && first.driveFile.driveFile.title ? "Google Drive file" : "Drive file";
  if (first.youtubeVideo) return "YouTube video";
  if (first.link) return "Web link";
  if (first.form) return "Google Form";
  return "Resource";
}

function normalizeAnnouncement(item, course) {
  const description = cleanText(item.text);
  return {
    id: `classroom:announcement:${item.id}`,
    externalId: item.id,
    type: "announcement",
    source: "classroom",
    courseName: course.name || "Google Classroom",
    title: description ? description.slice(0, 110) : "New Classroom announcement",
    description,
    author: null,
    postedAt: item.creationTime || item.updateTime || null,
    dueAt: null,
    url: courseUrl(course, item.alternateLink),
    createdAt: item.creationTime || item.updateTime || new Date().toISOString()
  };
}

function normalizeMaterial(item, course) {
  return {
    id: `classroom:material:${item.id}`,
    externalId: item.id,
    type: "material",
    source: "classroom",
    courseName: course.name || "Google Classroom",
    title: cleanText(item.title, 180) || "New course material",
    description: cleanText(item.description),
    author: null,
    materialType: materialKind(item.materials),
    postedAt: item.creationTime || item.updateTime || null,
    dueAt: null,
    url: courseUrl(course, item.alternateLink),
    createdAt: item.creationTime || item.updateTime || new Date().toISOString()
  };
}

function normalizeCoursework(item, course) {
  return {
    id: `classroom:assignment:${item.id}`,
    externalId: item.id,
    type: "assignment",
    source: "classroom",
    courseName: course.name || "Google Classroom",
    title: cleanText(item.title, 180) || "New assignment",
    description: cleanText(item.description),
    author: null,
    postedAt: item.creationTime || item.updateTime || null,
    dueAt: dueAt(item),
    url: courseUrl(course, item.alternateLink),
    createdAt: item.creationTime || item.updateTime || new Date().toISOString()
  };
}

async function activeCourses(token) {
  const data = await googleJson(`${CLASSROOM}/courses?courseStates=ACTIVE&pageSize=20`, token);
  return (data.courses || []).slice(0, 8);
}

async function classroomUpdates(token) {
  const courses = await activeCourses(token);
  const results = await Promise.all(courses.map(async course => {
    const id = encodeURIComponent(course.id);
    const settled = await Promise.allSettled([
      googleJson(`${CLASSROOM}/courses/${id}/announcements?pageSize=10&orderBy=updateTime%20desc`, token),
      googleJson(`${CLASSROOM}/courses/${id}/courseWorkMaterials?pageSize=10&orderBy=updateTime%20desc`, token),
      googleJson(`${CLASSROOM}/courses/${id}/courseWork?pageSize=10&orderBy=updateTime%20desc`, token)
    ]);
    const announcements = settled[0].status === "fulfilled" ? settled[0].value.announcements || [] : [];
    const materials = settled[1].status === "fulfilled" ? settled[1].value.courseWorkMaterial || [] : [];
    const coursework = settled[2].status === "fulfilled" ? settled[2].value.courseWork || [] : [];
    return [
      ...announcements.map(item => normalizeAnnouncement(item, course)),
      ...materials.map(item => normalizeMaterial(item, course)),
      ...coursework.map(item => normalizeCoursework(item, course))
    ];
  }));
  return { courses, updates: results.flat() };
}

function headerValue(message, name) {
  const headers = message.payload && Array.isArray(message.payload.headers) ? message.payload.headers : [];
  const found = headers.find(header => String(header.name).toLowerCase() === name.toLowerCase());
  return found ? found.value : "";
}

function isRelevantEmail(message, courses) {
  const from = headerValue(message, "From").toLowerCase();
  const subject = headerValue(message, "Subject").toLowerCase();
  const courseNames = courses.map(course => String(course.name || "").toLowerCase()).filter(name => name.length > 3);
  const classroomSender = /classroom|google\.com|no-?reply/.test(from);
  const academicSubject = /(classroom|assignment|announcement|material|course|activity|module|professor|instructor|due|posted|shared)/.test(subject);
  return (classroomSender && academicSubject) || courseNames.some(name => subject.includes(name));
}

function normalizeEmail(message, courses) {
  const subject = cleanText(headerValue(message, "Subject"), 180) || "Google Classroom email notification";
  const from = cleanText(headerValue(message, "From"), 120);
  const matchingCourse = courses.find(course => subject.toLowerCase().includes(String(course.name || "").toLowerCase()));
  return {
    id: `gmail:${message.id}`,
    externalId: message.id,
    type: "email",
    source: "gmail",
    courseName: matchingCourse ? matchingCourse.name : "Classroom email",
    title: subject,
    description: cleanText(message.snippet),
    author: from || null,
    postedAt: headerValue(message, "Date") || (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null),
    dueAt: null,
    url: `https://mail.google.com/mail/u/0/#inbox/${message.id}`,
    createdAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString()
  };
}

async function gmailUpdates(token, courses) {
  const list = await googleJson(`${GMAIL}/messages?labelIds=INBOX&maxResults=12`, token);
  const messages = await Promise.all((list.messages || []).map(item =>
    googleJson(`${GMAIL}/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token)
  ));
  return messages.filter(message => isRelevantEmail(message, courses)).map(message => normalizeEmail(message, courses));
}

function comparable(value) {
  return cleanText(value, 220).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupe(updates) {
  const byId = new Map();
  for (const item of updates) byId.set(item.id, item);
  const classroom = [...byId.values()].filter(item => item.source === "classroom");
  return [...byId.values()].filter(item => {
    if (item.source !== "gmail") return true;
    const emailText = comparable(`${item.courseName} ${item.title} ${item.description}`);
    const emailTime = timeValue(item.postedAt);
    return !classroom.some(other => {
      const classroomText = comparable(`${other.courseName} ${other.title}`);
      const sameWindow = Math.abs(timeValue(other.postedAt) - emailTime) < 72 * 60 * 60 * 1000;
      const words = classroomText.split(" ").filter(word => word.length > 4);
      const overlap = words.filter(word => emailText.includes(word)).length;
      return sameWindow && overlap >= Math.min(3, Math.max(1, words.length));
    });
  }).sort((a, b) => timeValue(b.postedAt || b.createdAt) - timeValue(a.postedAt || a.createdAt)).slice(0, 80);
}

export async function onRequestGet(context) {
  try {
    const valid = await validSession(context);
    if (!valid.session) return json({ status: "NOT_CONNECTED", error: "Connect Google first." }, 401);
    const session = valid.session;
    const preferences = session.preferences || { classroom: true, gmail: false, autoRefresh: true };
    let courses = [];
    let updates = [];
    const warnings = [];

    if (preferences.classroom !== false) {
      try {
        const result = await classroomUpdates(session.accessToken);
        courses = result.courses;
        updates.push(...result.updates);
      } catch (error) {
        warnings.push("Google Classroom couldn't be reached right now.");
      }
    }

    if (preferences.gmail) {
      if (!hasScope(session, GMAIL_SCOPE)) {
        warnings.push("Gmail notifications are disabled. Reauthorize Gmail access from Google Integration settings.");
      } else {
        try { updates.push(...await gmailUpdates(session.accessToken, courses)); }
        catch (_) { warnings.push("Gmail notifications couldn't be reached right now."); }
      }
    }

    const headers = valid.changed ? { "Set-Cookie": await sessionHeader(context, session) } : {};
    return json({
      status: warnings.length && !updates.length ? "PARTIAL" : "OK",
      checkedAt: new Date().toISOString(),
      updates: dedupe(updates),
      warnings
    }, 200, headers);
  } catch (error) {
    const needsReauthorization = /renewal|invalid_grant|expired/i.test(String(error && error.message));
    return json({
      status: needsReauthorization ? "REAUTHORIZE" : "ERROR",
      error: needsReauthorization ? "Your Google connection needs to be renewed." : "Google Classroom couldn't be reached right now."
    }, needsReauthorization ? 401 : 502);
  }
}
