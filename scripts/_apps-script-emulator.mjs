// Apps Script emulator — runs setup-database.gs for real, in Node.
//
// Used by scripts/test-sheets-e2e.mjs. Stubs the handful of Apps Script globals
// the script touches (SpreadsheetApp, Utilities, PropertiesService, CacheService,
// LockService, ContentService, Logger) over plain arrays, then evaluates the .gs
// file so the actual doPost/snapshot.read/batch.write code under test is the same
// code that will run in Google's runtime.
//
// Emulating rather than mocking matters here: a hand-written mock would agree
// with whatever the adapter happens to send, which is exactly the bug class this
// is meant to catch.

import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Spreadsheet emulation
// ---------------------------------------------------------------------------

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const source = this.sheet._rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const value = source[this.col - 1 + c];
        line.push(value === undefined ? "" : value);
      }
      out.push(line);
    }
    return out;
  }

  setValues(values) {
    if (values.length !== this.numRows) {
      throw new Error(`setValues: expected ${this.numRows} rows, got ${values.length}`);
    }
    for (const line of values) {
      if (line.length !== this.numCols) {
        throw new Error(`setValues: expected ${this.numCols} columns, got ${line.length}`);
      }
    }
    for (let r = 0; r < this.numRows; r++) {
      const target = this.row - 1 + r;
      while (this.sheet._rows.length <= target) this.sheet._rows.push([]);
      const line = this.sheet._rows[target];
      for (let c = 0; c < this.numCols; c++) {
        const value = values[r][c];
        // Sheets rejects an oversized cell; surface it the same way.
        if (typeof value === "string" && value.length > 50000) {
          throw new Error("Cell value exceeds 50000 characters");
        }
        line[this.col - 1 + c] = this.sheet.coerceCell(this.col - 1 + c, value);
      }
    }
    return this;
  }

  setValue(value) {
    return this.setValues([[value]]);
  }

  /** Sheets applies a number format per column; '@' means text. */
  setNumberFormat(format) {
    for (let c = 0; c < this.numCols; c++) {
      this.sheet._colFormats[this.col - 1 + c] = format;
    }
    return this;
  }

  // Formatting is irrelevant to behaviour; accept and ignore.
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this._rows = [];
    this._maxColumns = 26;
    this._maxRows = 1000;
    this._colFormats = {};
  }

  /**
   * Sheets stores a typed value, not the string you hand it: "08:00" in a
   * general-format column becomes a real time value on the 1899 epoch, and the
   * Apps Script then serialises it with toISOString(). Reproduce that so the
   * "times arrive as ISO datetimes" bug can never hide behind a fake sheet that
   * keeps every string verbatim. A column formatted as text ('@') keeps strings.
   */
  coerceCell(colIndex, value) {
    if (this._colFormats[colIndex] === "@") return value;
    if (typeof value !== "string") return value;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(value.trim());
    if (!m) return value;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = m[3] ? parseInt(m[3], 10) : 0;
    const mer = (m[4] || "").toUpperCase();
    if (min > 59 || h > 23 || (mer && h > 12)) return value;
    if (mer === "PM" && h < 12) h += 12;
    if (mer === "AM" && h === 12) h = 0;
    return new Date(1899, 11, 30, h, min, sec);
  }

  getName() { return this.name; }
  getMaxColumns() { return this._maxColumns; }
  getMaxRows() { return this._maxRows; }
  insertColumnsAfter(position, count) { this._maxColumns += count; return this; }
  insertRowsAfter(position, count) { this._maxRows += count; return this; }

  getLastRow() {
    for (let i = this._rows.length - 1; i >= 0; i--) {
      if ((this._rows[i] || []).some((v) => v !== "" && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }

  getLastColumn() {
    let max = 0;
    for (const row of this._rows) {
      for (let c = (row || []).length - 1; c >= 0; c--) {
        const v = row[c];
        if (v !== "" && v !== null && v !== undefined) { max = Math.max(max, c + 1); break; }
      }
    }
    return max;
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    if (row + numRows - 1 > this._maxRows || col + numCols - 1 > this._maxColumns) throw new Error('Range exceeds grid limits');
    return new FakeRange(this, row, col, numRows, numCols);
  }

  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  appendRow(values) {
    this._maxRows = Math.max(this._maxRows, this.getLastRow() + 1);
    this._rows[this.getLastRow()] = values.map((v, i) => this.coerceCell(i, v));
    return this;
  }

  deleteRow(position) {
    this._rows.splice(position - 1, 1);
    return this;
  }
  deleteRows(position, count) { this._rows.splice(position - 1, count); return this; }

  setFrozenRows() { return this; }
}

class FakeSpreadsheet {
  constructor() { this._sheets = []; }
  getId() { return 'test-spreadsheet'; }
  getSheets() { return this._sheets.slice(); }
  getSheetByName(name) { return this._sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this._sheets.push(sheet);
    return sheet;
  }
}

// ---------------------------------------------------------------------------
// Runtime emulation
// ---------------------------------------------------------------------------

/**
 * Load setup-database.gs and return its callable entry points.
 * Returns { doPost, doGet, setupDatabase, seedCatalogData, spreadsheet, logs }.
 */
export async function loadAppsScript({ repoRoot, secret, properties = {}, driveFiles = new Map(), standalone = false }) {
  const source = await readFile(resolve(repoRoot, "setup-database.gs"), "utf8");
  const spreadsheet = new FakeSpreadsheet();
  const logs = [];
  const cache = new Map();
  let lockHeld = false;

  const globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => standalone ? null : spreadsheet,
      openById: id => { if (id !== spreadsheet.getId()) throw new Error('Spreadsheet unavailable'); return spreadsheet; },
      getUi: () => {
        // Google throws this when there is no attached UI, e.g. an API call.
        throw new Error("Cannot call SpreadsheetApp.getUi() from this context.");
      },
    },

    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' },
      Permission: { NONE: 'NONE' },
      createFile(blob) {
        const id = randomUUID();
        const file = { ...blob, trashed: false };
        driveFiles.set(id, file);
        return { getId: () => id, setSharing(access, permission) { file.access = access; file.permission = permission; } };
      },
      getFileById(id) {
        const file = driveFiles.get(id);
        if (!file) throw new Error('File unavailable');
        return { getBlob: () => ({ getBytes: () => file.bytes }), setTrashed(value) { if (file.failTrash) throw new Error('Drive permission denied'); file.trashed = value; } };
      },
    },

    Utilities: {
      base64Decode: value => [...Buffer.from(value, 'base64')],
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mimeType, filename) => ({ bytes, mimeType, filename }),
      computeHmacSha256Signature(message, key) {
        const digest = createHmac("sha256", key).update(message, "utf8").digest();
        // Apps Script hands back signed bytes; reproduce that so the script's
        // own (b + 256) % 256 masking is exercised rather than bypassed.
        return Array.from(digest, (b) => (b > 127 ? b - 256 : b));
      },
      getUuid: () => randomUUID(),
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => (name === "APPS_SCRIPT_SECRET" ? secret : properties[name] || null),
      }),
    },

    CacheService: {
      getScriptCache: () => ({
        get: (key) => {
          const hit = cache.get(key);
          if (!hit) return null;
          if (hit.expires < Date.now()) { cache.delete(key); return null; }
          return hit.value;
        },
        put: (key, value, seconds) => {
          cache.set(key, { value, expires: Date.now() + seconds * 1000 });
        },
      }),
    },

    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (lockHeld) return false;
          lockHeld = true;
          return true;
        },
        releaseLock: () => { lockHeld = false; },
      }),
    },

    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; },
        getContent() { return this.content; },
      }),
    },

    Logger: { log: (message) => logs.push(String(message)) },
  };

  // Evaluate the script with the emulated globals in scope, then hand back the
  // entry points. Function-scoped rather than global so two emulators can run
  // side by side without sharing state.
  const names = Object.keys(globals);
  const factory = new Function(
    ...names,
    `${source}
    return { doPost, doGet, setupDatabase, seedCatalogData, getSheetDefinitions, getEntityRegistry,
      rowToObject, formatTimeCell, ensureTimeCellsAreText, isTimeOfDayColumn };`
  );

  const api = factory(...names.map((n) => globals[n]));
  return { ...api, spreadsheet, logs };
}

/** Shape a doPost result like an HTTP response body. */
export function parseOutput(output) {
  return JSON.parse(output.getContent());
}

