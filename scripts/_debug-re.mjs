/* Validates a corrected SUSP_RE against realistic QC / DepEd announcement
   phrasings. A false negative renders a confident "Classes are in session" on a
   suspension day — the exact failure the engine is designed to prevent — so the
   positives here matter more than the negatives. */

const OLD = /(walang\s+pasok|class(?:es)?\s+(?:are\s+)?suspend|suspension\s+of\s+class|no\s+class(?:es)?|cancellation\s+of\s+class|classes?\s+cancel|face-?to-?face\s+class(?:es)?\s+(?:are\s+)?suspend|suspend\w*\s+.{0,30}?class|walang\s+klase|holiday\s+for\s+all\s+school)/i;

// suspen[ds]\w* covers BOTH stems: suspend/suspended/suspends AND
// suspension/suspensions. [^.!?] keeps a match inside one sentence.
const NEW = /(walang\s+pasok|walang\s+klase|holiday\s+for\s+all\s+school|cancellation\s+of\s+class|classes?\s+cancel|no\s+class(?:es)?|suspen[ds]\w*\b[^.!?]{0,40}?\bclass|\bclass(?:es)?\b[^.!?]{0,25}?\bsuspen[ds])/i;

const POSITIVE = [
  "Walang Pasok: Afternoon Face-to-Face Classes – August 17, 2026",
  "Suspension of Classes",
  "Suspension of Afternoon Face-to-Face Classes",
  "Suspension of Classes in All Levels",
  "Suspension of face-to-face classes in public and private schools",
  "Class Suspension",
  "Class Suspension Advisory",
  "Afternoon Classes Suspension",
  "Classes and Work Suspension in Quezon City",
  "All classes are suspended today.",
  "Classes suspended in all levels",
  "Cancellation of Classes",
  "Walang Klase ngayong araw",
  "QCU announces suspension of classes",
  "Suspension of Afternoon Classes in All Levels, Public and Private",
];

const NEGATIVE = [
  "Suspension of Water Service in Barangay Commonwealth",
  "Notice of Business Permit Suspension for Non-Compliant Establishments",
  "Enrollment for new classes begins Monday",
  "Free vaccination schedule at all health centers",
  "Road reblocking along Commonwealth Avenue this weekend",
  "QCU Opens Registration for Second Semester",
];

let fail = 0;
const pad = (s) => (s + "                    ").slice(0, 8);

console.log("POSITIVES — must match (old / new)");
for (const t of POSITIVE) {
  const o = OLD.test(t), n = NEW.test(t);
  if (!n) fail++;
  const flag = !n ? "  <<< NEW FAILS" : (!o && n ? "   [fixed]" : "");
  console.log("  " + pad(o ? "MATCH" : "MISS") + pad(n ? "MATCH" : "MISS") + t + flag);
}

console.log("\nNEGATIVES — must NOT match (old / new)");
for (const t of NEGATIVE) {
  const o = OLD.test(t), n = NEW.test(t);
  if (n) fail++;
  console.log("  " + pad(o ? "match" : "ok") + pad(n ? "match" : "ok") + t + (n ? "  <<< NEW FALSE POSITIVE" : ""));
}

const oldMisses = POSITIVE.filter((t) => !OLD.test(t));
console.log("\nold regex missed " + oldMisses.length + " of " + POSITIVE.length + " real phrasings:");
oldMisses.forEach((t) => console.log("   · " + t));

console.log("\n" + (fail === 0 ? "NEW REGEX OK — all positives caught, no false positives" : fail + " FAILURE(S)"));
process.exit(fail === 0 ? 0 : 1);
