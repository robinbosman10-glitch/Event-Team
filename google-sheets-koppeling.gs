/**
 * AFR Event Team – Discord/Google Sheets-koppeling
 *
 * Installatie:
 * 1. Open de AFR-spreadsheet.
 * 2. Kies Extensies > Apps Script en plak dit hele bestand in Code.gs.
 * 3. Voer setupSpreadsheetWebhook één keer uit en kopieer de secret uit het uitvoeringslog.
 * 4. Kies Implementeren > Nieuwe implementatie > Web-app.
 * 5. Uitvoeren als: ikzelf. Toegang: iedereen.
 * 6. Zet de /exec-URL als SHEET_WEBHOOK_URL bij de bot.
 * 7. Zet de gekopieerde secret als SHEET_WEBHOOK_SECRET bij de bot.
 */

const AFR_SHEET_GID = 0;
const AFR_SPREADSHEET_ID_PROPERTY = "AFR_SPREADSHEET_ID";
const AFR_SECRET_PROPERTY = "AFR_SHEET_WEBHOOK_SECRET";
const AFR_HEADER_SEARCH_ROWS = 20;
const AFR_ACCEPTED_COLUMNS = Object.freeze({
  name: 3,
  discordId: 4,
  status: 5,
  acceptedDate: 6,
  lastChanged: 7,
  changedBy: 8,
  acceptedBy: 9,
  staffRank: 11,
});
const AFR_STAFF_RANKS = Object.freeze([
  "Hoge Raad",
  "Hoofd Management",
  "Management",
  "Junior Management",
  "Senior Admin",
  "Admin",
  "Junior Admin",
  "Senior Moderator",
  "Moderator",
  "Junior Moderator",
  "N.V.T.",
]);

function setupSpreadsheetWebhook() {
  const secret = `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, "");
  const spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();

  PropertiesService.getScriptProperties().setProperties({
    [AFR_SPREADSHEET_ID_PROPERTY]: spreadsheetId,
    [AFR_SECRET_PROPERTY]: secret,
  });
  console.log(`SHEET_WEBHOOK_SECRET=${secret}`);
  return "Klaar. Spreadsheet-ID is privé opgeslagen. Kopieer SHEET_WEBHOOK_SECRET uit het uitvoeringslog.";
}

function doGet() {
  const spreadsheetId = getSpreadsheetId_();
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = getConfiguredSheet_(spreadsheet);

  return jsonResponse_({
    ok: true,
    service: "AFR spreadsheet webhook",
    sheetGid: AFR_SHEET_GID,
    sheet: sheet ? sheet.getName() : null,
  });
}

function doPost(event) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
    const requestBody =
      event && event.postData ? event.postData.contents : "{}";
    const request = JSON.parse(requestBody || "{}");
    const expectedSecret = PropertiesService.getScriptProperties().getProperty(
      AFR_SECRET_PROPERTY,
    );

    if (!expectedSecret || request.secret !== expectedSecret) {
      throw new Error("Ongeldige webhook-secret.");
    }

    const result = processDiscordEvent_(request.type, request.data || {});
    SpreadsheetApp.flush();
    return jsonResponse_({ ok: true, result });
  } catch (error) {
    console.error(error.stack || error);
    return jsonResponse_({ ok: false, error: error.message });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function processDiscordEvent_(type, data) {
  const context = getSheetContext_();

  switch (type) {
    case "ping":
      return {
        sheetName: context.sheet.getName(),
        headerRow: context.headerRow,
        lastDataRow: context.lastDataRow,
      };
    case "accepted":
      return applyAccepted_(context, data);
    case "rank_changed":
      return applyRankChange_(context, data);
    case "warning":
      return applyWarning_(context, data);
    case "warning_removed":
      return applyWarningRemoval_(context, data);
    case "terminated":
      return applyTermination_(context, data);
    case "departed":
      return applyDeparture_(context, data, "Uit dienst");
    default:
      throw new Error(`Onbekend gebeurtenistype: ${type}`);
  }
}

function getSheetContext_() {
  const spreadsheet = SpreadsheetApp.openById(getSpreadsheetId_());
  const sheet = getConfiguredSheet_(spreadsheet);

  if (!sheet) throw new Error(`Tabblad met gid=${AFR_SHEET_GID} niet gevonden.`);

  const searchRows = Math.min(AFR_HEADER_SEARCH_ROWS, sheet.getMaxRows());
  const searchColumns = Math.min(30, sheet.getMaxColumns());
  const displayed = sheet
    .getRange(1, 1, searchRows, searchColumns)
    .getDisplayValues();
  let headerRow = 0;
  let headers = {};

  for (let rowIndex = 0; rowIndex < displayed.length; rowIndex += 1) {
    const candidate = {};

    displayed[rowIndex].forEach((value, columnIndex) => {
      const key = normalizeHeader_(value);
      if (key) candidate[key] = columnIndex + 1;
    });

    if (candidate.rang && candidate.naam && candidate.discordid) {
      headerRow = rowIndex + 1;
      headers = candidate;
      break;
    }
  }

  if (!headerRow) {
    throw new Error("Kolomkoppen Rang, Naam en Discord ID zijn niet gevonden.");
  }

  return {
    spreadsheet,
    sheet,
    headerRow,
    firstDataRow: headerRow + 1,
    lastDataRow: sheet.getLastRow(),
    headers,
  };
}

function getSpreadsheetId_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    AFR_SPREADSHEET_ID_PROPERTY,
  );

  if (!spreadsheetId) {
    throw new Error(
      "Spreadsheet-ID ontbreekt. Voer setupSpreadsheetWebhook één keer uit vanuit de gekoppelde spreadsheet.",
    );
  }

  return spreadsheetId;
}

function getConfiguredSheet_(spreadsheet) {
  const sheets = spreadsheet.getSheets();

  for (let index = 0; index < sheets.length; index += 1) {
    if (sheets[index].getSheetId() === AFR_SHEET_GID) return sheets[index];
  }

  return null;
}

function normalizeHeader_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDiscordId_(value) {
  const match = String(value || "").match(/\d{17,20}/);
  return match ? match[0] : "";
}

function normalizeText_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bafr\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleMatchScore_(sheetRank, discordRank) {
  const left = normalizeText_(sheetRank);
  const right = normalizeText_(discordRank);

  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.replace(/\s+/g, "") === right.replace(/\s+/g, "")) return 95;
  if (left.includes(right) || right.includes(left)) return 90;

  const leftWords = new Set(left.split(/\s+/));
  const rightWords = new Set(right.split(/\s+/));
  const common = [...leftWords].filter((word) => rightWords.has(word)).length;
  return common / Math.max(leftWords.size, rightWords.size);
}

function findMemberRow_(context, discordId) {
  const idColumn = context.headers.discordid;
  const rowCount = Math.max(0, context.lastDataRow - context.firstDataRow + 1);

  if (!discordId || !rowCount) return null;

  const values = context.sheet
    .getRange(context.firstDataRow, idColumn, rowCount, 1)
    .getDisplayValues();
  const wantedId = normalizeDiscordId_(discordId);
  const index = values.findIndex(
    ([value]) => normalizeDiscordId_(value) === wantedId,
  );

  return index < 0 ? null : context.firstDataRow + index;
}

function findEmptyRankRow_(context, rankName) {
  const rowCount = Math.max(0, context.lastDataRow - context.firstDataRow + 1);

  if (!rankName || !rowCount) {
    throw new Error("Nieuwe Discord-rang ontbreekt.");
  }

  const ranks = context.sheet
    .getRange(context.firstDataRow, context.headers.rang, rowCount, 1)
    .getDisplayValues();
  const ids = context.sheet
    .getRange(context.firstDataRow, context.headers.discordid, rowCount, 1)
    .getDisplayValues();
  const candidates = ranks
    .map(([rank], index) => ({
      row: context.firstDataRow + index,
      rank,
      score: roleMatchScore_(rank, rankName),
      empty: !normalizeDiscordId_(ids[index][0]),
    }))
    .filter((candidate) => candidate.empty && candidate.score >= 0.6)
    .sort((a, b) => b.score - a.score || a.row - b.row);

  if (!candidates.length) {
    throw new Error(`Geen lege, passende rij gevonden voor rang '${rankName}'.`);
  }

  return candidates[0].row;
}

function getAllowedValues_(cell) {
  const rule = cell.getDataValidation();

  if (!rule) return null;

  const type = rule.getCriteriaType();
  const args = rule.getCriteriaValues();

  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    return args[0].map(String);
  }

  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    return args[0].getDisplayValues().flat().filter(Boolean).map(String);
  }

  return null;
}

function selectAllowedValue_(cell, wantedValues, fallbackToEmpty) {
  const wanted = (Array.isArray(wantedValues) ? wantedValues : [wantedValues])
    .filter((value) => value !== null && value !== undefined && value !== "");
  const allowed = getAllowedValues_(cell);

  if (!allowed) {
    if (wanted.length) cell.setValue(wanted[0]);
    else if (fallbackToEmpty) cell.clearContent();
    return wanted[0] || "";
  }

  let best = null;
  let bestScore = 0;

  for (const option of allowed) {
    for (const value of wanted) {
      const score = roleMatchScore_(option, value);
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
  }

  if (best && bestScore >= 0.6) {
    cell.setValue(best);
    return best;
  }

  const neutral = allowed.find((option) =>
    ["nvt", "niet van toepassing", "geen"].includes(normalizeHeader_(option)),
  );

  if (neutral) {
    cell.setValue(neutral);
    return neutral;
  }

  if (fallbackToEmpty) cell.clearContent();
  return "";
}

function setColumnValue_(context, row, headerName, value, validated) {
  const column = context.headers[normalizeHeader_(headerName)];
  if (!column) return false;

  return setColumnNumberValue_(context, row, column, value, validated);
}

function setColumnNumberValue_(
  context,
  row,
  column,
  value,
  validated,
  overwriteFormula,
) {
  const cell = context.sheet.getRange(row, column);
  if (cell.getFormula()) {
    if (!overwriteFormula) return false;
    cell.clearContent();
  }

  if (validated) selectAllowedValue_(cell, value, false);
  else cell.setValue(value);
  return true;
}

function clearColumnNumberValue_(context, row, column) {
  const cell = context.sheet.getRange(row, column);
  if (cell.getFormula()) return false;

  cell.clearContent();
  return true;
}

function parseDutchDate_(value) {
  const match = String(value || "").match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (!match) return new Date();
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function getStaffRankCandidates_(data) {
  const requestedRank = normalizeText_(data.staffRankName);
  const canonicalRank = AFR_STAFF_RANKS.find(
    (rankName) => normalizeText_(rankName) === requestedRank,
  );

  return [canonicalRank, data.staffRankName, data.staffRankId];
}

function moveMemberRow_(context, sourceRow, destinationRow) {
  if (!sourceRow || sourceRow === destinationRow) return;

  const protectedHeaders = new Set(["rang"]);

  Object.entries(context.headers).forEach(([header, column]) => {
    if (protectedHeaders.has(header)) return;

    const sourceCell = context.sheet.getRange(sourceRow, column);
    const destinationCell = context.sheet.getRange(destinationRow, column);

    if (!destinationCell.getFormula()) {
      const sourceValue = sourceCell.getValue();
      const allowed = getAllowedValues_(destinationCell);

      if (allowed) selectAllowedValue_(destinationCell, sourceValue, true);
      else destinationCell.setValue(sourceValue);
    }
  });

  clearMemberRow_(context, sourceRow);
}

function clearMemberRow_(context, row) {
  Object.entries(context.headers).forEach(([header, column]) => {
    if (header === "rang") return;

    const cell = context.sheet.getRange(row, column);
    if (cell.getFormula()) return;

    const rule = cell.getDataValidation();
    const criteria = rule ? rule.getCriteriaType() : null;

    if (criteria === SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
      cell.setValue(false);
    } else if (getAllowedValues_(cell)) {
      selectAllowedValue_(cell, ["N.V.T", "Geen"], true);
    } else {
      cell.clearContent();
    }
  });
}

function resetVacantMemberRow_(context, row) {
  clearMemberRow_(context, row);
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.name,
    "[AFR]",
    false,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.discordId,
    "<@>",
    false,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.status,
    ["N.V.T.", "N.V.T", "NVT"],
    true,
  );
  clearColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.acceptedDate,
  );
  clearColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.lastChanged,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.changedBy,
    ["N.V.T.", "N.V.T", "NVT"],
    true,
    true,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.acceptedBy,
    ["N.V.T.", "N.V.T", "NVT"],
    true,
    true,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.staffRank,
    ["N.V.T.", "N.V.T", "NVT"],
    true,
    true,
  );
}

function getRankBlockEnd_(context, row) {
  const rankColumn = context.headers.rang;
  const rankName = context.sheet.getRange(row, rankColumn).getDisplayValue();
  const normalizedRank = normalizeText_(rankName);
  let endRow = row;

  for (
    let candidateRow = row + 1;
    candidateRow <= context.lastDataRow;
    candidateRow += 1
  ) {
    const candidateRank = context.sheet
      .getRange(candidateRow, rankColumn)
      .getDisplayValue();

    if (normalizeText_(candidateRank) !== normalizedRank) break;
    endRow = candidateRow;
  }

  return endRow;
}

function ensureMemberAtRank_(context, data) {
  const sourceRow = findMemberRow_(context, data.discordId);
  const destinationRow = findEmptyRankRow_(context, data.newRankName || data.rankName);

  moveMemberRow_(context, sourceRow, destinationRow);
  setColumnValue_(context, destinationRow, "Naam", data.name || "Onbekend", false);
  setColumnValue_(context, destinationRow, "Discord ID", `<@${data.discordId}>`, false);
  return destinationRow;
}

function applyAccepted_(context, data) {
  let row = findMemberRow_(context, data.discordId);

  if (!row) {
    row = ensureMemberAtRank_(context, data);
  }

  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.name,
    data.name || "Onbekend",
    false,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.discordId,
    `<@${data.discordId}>`,
    false,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.status,
    ["Actief", "Active"],
    true,
  );
  const acceptedAt = parseDutchDate_(data.acceptedDate);

  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.acceptedDate,
    acceptedAt,
    false,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.lastChanged,
    acceptedAt,
    false,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.changedBy,
    ["Automatisch Systeem", "Automatische Systeem"],
    true,
    true,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.acceptedBy,
    [data.acceptedByName, data.acceptedById],
    true,
    true,
  );
  setColumnNumberValue_(
    context,
    row,
    AFR_ACCEPTED_COLUMNS.staffRank,
    getStaffRankCandidates_(data),
    true,
    true,
  );
  return `Aangenomen persoon bijgewerkt op rij ${row}.`;
}

function applyRankChange_(context, data) {
  const row = ensureMemberAtRank_(context, data);
  const changedAt = data.occurredAt ? new Date(data.occurredAt) : new Date();

  setColumnValue_(context, row, "Status", ["Actief", "Active"], true);
  setColumnValue_(context, row, "Laatste Wijziging", changedAt, false);
  setColumnValue_(
    context,
    row,
    "Gewijzigd door",
    [data.actorName, data.actorId],
    true,
  );
  return `Rang gewijzigd naar '${data.newRankName}' op rij ${row}.`;
}

function applyWarning_(context, data) {
  const row = findMemberRow_(context, data.discordId);
  if (!row) throw new Error(`Discord-ID ${data.discordId} staat niet in het tabblad.`);

  const warningColumn = context.headers.waarschuwingen;
  if (!warningColumn) throw new Error("Kolom Waarschuwingen niet gevonden.");

  const cell = context.sheet.getRange(row, warningColumn);
  const current = cell.getDisplayValue();
  const currentNumberMatch = current.match(/\d+/);
  const currentNumber = Number(currentNumberMatch ? currentNumberMatch[0] : 0);
  const nextNumber = currentNumber + 1;

  selectAllowedValue_(
    cell,
    [`Waarschuwing ${nextNumber}`, String(nextNumber)],
    false,
  );
  setColumnValue_(context, row, "Laatste Wijziging", new Date(), false);
  setColumnValue_(
    context,
    row,
    "Gewijzigd door",
    [data.actorName, data.actorId],
    true,
  );
  return `Waarschuwing ${nextNumber} bijgewerkt op rij ${row}.`;
}

function applyWarningRemoval_(context, data) {
  const row = findMemberRow_(context, data.discordId);
  if (!row) throw new Error(`Discord-ID ${data.discordId} staat niet in het tabblad.`);

  const warningColumn = context.headers.waarschuwingen;
  if (!warningColumn) throw new Error("Kolom Waarschuwingen niet gevonden.");

  const cell = context.sheet.getRange(row, warningColumn);
  const current = cell.getDisplayValue();
  const currentNumberMatch = current.match(/\d+/);
  const currentNumber = Number(currentNumberMatch ? currentNumberMatch[0] : 0);

  if (currentNumber <= 0) {
    throw new Error(`Discord-ID ${data.discordId} heeft geen waarschuwing in de spreadsheet.`);
  }

  const nextNumber = currentNumber - 1;
  const wantedValues = nextNumber > 0
    ? [`Waarschuwing ${nextNumber}`, String(nextNumber)]
    : ["N.V.T", "Niet van toepassing", "Geen", "0"];

  selectAllowedValue_(cell, wantedValues, nextNumber === 0);
  setColumnValue_(context, row, "Laatste Wijziging", new Date(), false);
  setColumnValue_(
    context,
    row,
    "Gewijzigd door",
    [data.actorName, data.actorId],
    true,
  );

  return nextNumber > 0
    ? `Waarschuwing verlaagd naar ${nextNumber} op rij ${row}.`
    : `Laatste waarschuwing verwijderd op rij ${row}; waarde teruggezet naar N.V.T.`;
}

function applyTermination_(context, data) {
  if (!data.discordId) {
    return "Geen Discord-ID; er is geen bestaande rij leeggemaakt.";
  }

  const row = findMemberRow_(context, data.discordId);
  if (!row) return `Discord-ID ${data.discordId} stond niet in het tabblad.`;

  const rankBlockEnd = getRankBlockEnd_(context, row);
  let destinationRow = row;

  for (
    let sourceRow = row + 1;
    sourceRow <= rankBlockEnd;
    sourceRow += 1
  ) {
    const sourceDiscordId = normalizeDiscordId_(
      context.sheet
        .getRange(sourceRow, context.headers.discordid)
        .getDisplayValue(),
    );

    if (!sourceDiscordId) continue;

    moveMemberRow_(context, sourceRow, destinationRow);
    destinationRow += 1;
  }

  resetVacantMemberRow_(context, destinationRow);
  return `Ontslagen persoon verwijderd; lege regel staat onderaan het rangblok op rij ${destinationRow}.`;
}

function applyDeparture_(context, data, preferredStatus) {
  if (!data.discordId) return "Geen Discord-ID; er is geen bestaande rij aangepast.";

  const row = findMemberRow_(context, data.discordId);
  if (!row) return `Discord-ID ${data.discordId} stond niet in het tabblad.`;

  setColumnValue_(
    context,
    row,
    "Status",
    [preferredStatus, "Inactief", "Niet actief"],
    true,
  );
  setColumnValue_(context, row, "Laatste Wijziging", new Date(), false);
  setColumnValue_(
    context,
    row,
    "Gewijzigd door",
    [data.actorName, data.actorId],
    true,
  );
  return `${preferredStatus} bijgewerkt op rij ${row}.`;
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
