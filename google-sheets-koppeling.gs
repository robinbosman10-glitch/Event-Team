/**
 * AFR Event Team – nieuwe Google Sheets-koppeling
 * Voor de spreadsheet met tabblad "AFR Event Team" en kolommen:
 * Rang, Naam, Discord ID, Status, Aangenomen op, Aangenomen door,
 * Waarschuwingen, Sollicitatie behandelaar en Afwezig.
 */

const AFR_TABBLAD = "AFR Event Team";
const AFR_LOGBLAD = "Automatisering Logboek";
const AFR_SECRET_KEY = "AFR_NIEUWE_SHEET_SECRET";
const AFR_SPREADSHEET_KEY = "AFR_NIEUWE_SPREADSHEET_ID";

function setupAfrKoppeling() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Open dit script vanuit de nieuwe AFR-spreadsheet.");

  const sheet = spreadsheet.getSheetByName(AFR_TABBLAD);
  if (!sheet) throw new Error(`Tabblad '${AFR_TABBLAD}' is niet gevonden.`);

  spreadsheet.setSpreadsheetTimeZone("Europe/Amsterdam");
  const secret = `${Utilities.getUuid()}${Utilities.getUuid()}`.replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperties({
    [AFR_SPREADSHEET_KEY]: spreadsheet.getId(),
    [AFR_SECRET_KEY]: secret,
  });

  maakSollicitatieVinkjes_(sheet);
  haalLogblad_(spreadsheet);

  console.log(`SHEET_WEBHOOK_SECRET=${secret}`);
  console.log(`SPREADSHEET_ID=${spreadsheet.getId()}`);
  return "Koppeling ingesteld. Kopieer SHEET_WEBHOOK_SECRET uit het uitvoeringslog.";
}

function doGet() {
  try {
    const context = haalContext_();
    return json_({
      ok: true,
      service: "AFR Event Team nieuwe spreadsheetkoppeling",
      spreadsheetId: context.spreadsheet.getId(),
      sheet: context.sheet.getName(),
      headerRow: context.headerRow,
      lastRow: context.lastRow,
    });
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const request = JSON.parse(event && event.postData ? event.postData.contents : "{}");
    const secret = PropertiesService.getScriptProperties().getProperty(AFR_SECRET_KEY);
    if (!secret || request.secret !== secret) throw new Error("Ongeldige webhook-secret.");

    const result = verwerkActie_(String(request.type || ""), request.data || {});
    SpreadsheetApp.flush();
    return json_({ ok: true, result });
  } catch (error) {
    console.error(error.stack || error);
    return json_({ ok: false, error: error.message });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function verwerkActie_(type, data) {
  const context = haalContext_();
  let result;

  switch (type) {
    case "ping":
      return {
        spreadsheetId: context.spreadsheet.getId(),
        sheet: context.sheet.getName(),
        sheetName: context.sheet.getName(),
        headerRow: context.headerRow,
        lastDataRow: context.lastRow,
        rows: context.lastRow - context.firstRow + 1,
      };
    case "members":
      return haalAlleLeden_(context);
    case "accepted":
      result = neemAan_(context, data);
      break;
    case "promoted":
      result = promoveer_(context, data);
      break;
    case "warning_set":
      result = stelWaarschuwingIn_(context, data);
      break;
    case "absence_changed":
      result = stelAfwezigheidIn_(context, data);
      break;
    case "status_changed":
      result = stelStatusIn_(context, data);
      break;
    case "terminated":
      result = ontsla_(context, data);
      break;
    default:
      throw new Error(`Onbekende actie '${type}'.`);
  }

  schrijfLog_(context.spreadsheet, type, data, result);
  return result;
}

function haalAlleLeden_(context) {
  const count = context.lastRow - context.firstRow + 1;
  if (count < 1) return { members: [], count: 0, message: "Geen ingevulde leden gevonden." };

  const width = context.sheet.getMaxColumns();
  const displayValues = context.sheet
    .getRange(context.firstRow, 1, count, width)
    .getDisplayValues();

  const waarde = (row, header) => {
    const column = context.headers[normaliseerKop_(header)];
    return column ? String(row[column - 1] || "").trim() : "";
  };

  const members = displayValues.map(row => ({
    rank: waarde(row, "Rang"),
    name: waarde(row, "Naam"),
    discordId: normaliseerDiscordId_(waarde(row, "Discord ID")),
    status: waarde(row, "Status") || "Actief",
    acceptedDate: waarde(row, "Aangenomen op") || "Onbekend",
    acceptedBy: waarde(row, "Aangenomen door") || "Onbekend",
    warnings: waarde(row, "Waarschuwingen") || "Geen",
    absent: waarde(row, "Afwezig") || "Nee",
  })).filter(member => member.discordId && member.name);

  return {
    members,
    count: members.length,
    message: `${members.length} ingevulde leden opgehaald.`,
  };
}

function haalContext_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(AFR_SPREADSHEET_KEY);
  if (!spreadsheetId) throw new Error("Voer setupAfrKoppeling eerst één keer uit.");

  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(AFR_TABBLAD);
  if (!sheet) throw new Error(`Tabblad '${AFR_TABBLAD}' is niet gevonden.`);

  const values = sheet.getRange(1, 1, Math.min(25, sheet.getMaxRows()), sheet.getMaxColumns()).getDisplayValues();
  let headerRow = 0;
  let headers = {};

  for (let r = 0; r < values.length; r += 1) {
    const candidate = {};
    values[r].forEach((value, index) => {
      const key = normaliseerKop_(value);
      if (key) candidate[key] = index + 1;
    });
    if (candidate.rang && candidate.naam && candidate.discordid && candidate.status) {
      headerRow = r + 1;
      headers = candidate;
      break;
    }
  }

  if (!headerRow) throw new Error("De categorie-koppen zijn niet gevonden.");
  return {
    spreadsheet,
    sheet,
    headers,
    headerRow,
    firstRow: headerRow + 1,
    lastRow: sheet.getLastRow(),
  };
}

function neemAan_(context, data) {
  verplicht_(data.discordId, "Discord-lid");
  verplicht_(data.name, "Naam");
  const rank = data.rank || data.rankName;
  const acceptedBy = data.acceptedBy || data.acceptedByName;
  verplicht_(rank, "Rang");
  verplicht_(acceptedBy, "Aangenomen door");

  const row = zorgVoorRang_(context, data.discordId, rank);
  zetWaarde_(context, row, "Naam", data.name);
  zetWaarde_(context, row, "Discord ID", String(data.discordId));
  zetKeuze_(context, row, "Status", data.status || "Actief");
  zetWaarde_(context, row, "Aangenomen op", parseDatum_(data.acceptedDate));
  zetKeuze_(context, row, "Aangenomen door", acceptedBy);
  zetKeuze_(context, row, "Waarschuwingen", data.warnings || "Geen");
  zetVinkje_(context, row, "Sollicitatie behandelaar", Boolean(data.applicationHandler));
  zetKeuze_(context, row, "Afwezig", data.absent ? "Ja" : "Nee");

  return { message: `Volledige spreadsheetregel ingevuld op rij ${row}.`, row };
}

function promoveer_(context, data) {
  verplicht_(data.discordId, "Discord-lid");
  verplicht_(data.newRank, "Nieuwe rang");
  const oldRow = vindLidRij_(context, data.discordId);
  if (!oldRow) throw new Error(`Discord-ID ${data.discordId} staat niet in de spreadsheet.`);

  const row = zorgVoorRang_(context, data.discordId, data.newRank);
  zetKeuze_(context, row, "Status", "Actief");
  return { message: `Gepromoveerd naar ${data.newRank}; gegevens staan op rij ${row}.`, row };
}

function stelWaarschuwingIn_(context, data) {
  const row = vereisLidRij_(context, data.discordId);
  zetKeuze_(context, row, "Waarschuwingen", data.warning || "Geen");
  return { message: `Waarschuwing aangepast naar ${data.warning || "Geen"} op rij ${row}.`, row };
}

function stelAfwezigheidIn_(context, data) {
  const row = vereisLidRij_(context, data.discordId);
  zetKeuze_(context, row, "Afwezig", data.absent ? "Ja" : "Nee");
  return { message: `Afwezig aangepast naar ${data.absent ? "Ja" : "Nee"} op rij ${row}.`, row };
}

function stelStatusIn_(context, data) {
  const row = vereisLidRij_(context, data.discordId);
  zetKeuze_(context, row, "Status", data.status || "Actief");
  return { message: `Status aangepast naar ${data.status || "Actief"} op rij ${row}.`, row };
}

function ontsla_(context, data) {
  const row = vereisLidRij_(context, data.discordId);
  maakLidRijLeeg_(context, row);
  return { message: `Lid verwijderd; plek op rij ${row} is weer vrij.`, row };
}

function zorgVoorRang_(context, discordId, rank) {
  const sourceRow = vindLidRij_(context, discordId);
  if (sourceRow) {
    const currentRank = context.sheet.getRange(sourceRow, context.headers.rang).getDisplayValue();
    if (rangScore_(currentRank, rank) >= 0.75) return sourceRow;
  }

  const destinationRow = vindVrijeRangRij_(context, rank);
  if (sourceRow) verplaatsLid_(context, sourceRow, destinationRow);
  return destinationRow;
}

function vindLidRij_(context, discordId) {
  const wanted = normaliseerDiscordId_(discordId);
  const count = context.lastRow - context.firstRow + 1;
  if (!wanted || count < 1) return null;
  const ids = context.sheet.getRange(context.firstRow, context.headers.discordid, count, 1).getDisplayValues();
  const index = ids.findIndex(([value]) => normaliseerDiscordId_(value) === wanted);
  return index < 0 ? null : context.firstRow + index;
}

function vereisLidRij_(context, discordId) {
  verplicht_(discordId, "Discord-lid");
  const row = vindLidRij_(context, discordId);
  if (!row) throw new Error(`Discord-ID ${discordId} staat niet in de spreadsheet.`);
  return row;
}

function vindVrijeRangRij_(context, rank) {
  const count = context.lastRow - context.firstRow + 1;
  const ranks = context.sheet.getRange(context.firstRow, context.headers.rang, count, 1).getDisplayValues();
  const ids = context.sheet.getRange(context.firstRow, context.headers.discordid, count, 1).getDisplayValues();
  const candidates = ranks.map(([value], index) => ({
    row: context.firstRow + index,
    score: rangScore_(value, rank),
    empty: !normaliseerDiscordId_(ids[index][0]),
  })).filter(item => item.empty && item.score >= 0.75)
    .sort((a, b) => b.score - a.score || a.row - b.row);

  if (!candidates.length) throw new Error(`Rang '${rank}' heeft geen vrije plek meer.`);
  return candidates[0].row;
}

function verplaatsLid_(context, sourceRow, destinationRow) {
  if (sourceRow === destinationRow) return;
  Object.entries(context.headers).forEach(([header, column]) => {
    if (header === "rang") return;
    const source = context.sheet.getRange(sourceRow, column);
    const destination = context.sheet.getRange(destinationRow, column);
    if (header === "sollicitatiebehandelaar") {
      zetVinkjeOpCel_(destination, Boolean(source.getValue()));
    } else {
      const value = source.getValue();
      const allowed = toegestaneWaarden_(destination);
      if (allowed) zetKeuzeOpCel_(destination, value);
      else destination.setValue(value);
    }
  });
  maakLidRijLeeg_(context, sourceRow);
}

function maakLidRijLeeg_(context, row) {
  Object.entries(context.headers).forEach(([header, column]) => {
    if (header === "rang") return;
    const cell = context.sheet.getRange(row, column);
    if (header === "waarschuwingen") zetKeuzeOpCel_(cell, "Geen");
    else if (header === "afwezig") zetKeuzeOpCel_(cell, "Nee");
    else if (header === "sollicitatiebehandelaar") zetVinkjeOpCel_(cell, false);
    else cell.clearContent();
  });
}

function zetWaarde_(context, row, header, value) {
  const column = context.headers[normaliseerKop_(header)];
  if (!column) throw new Error(`Kolom '${header}' ontbreekt.`);
  context.sheet.getRange(row, column).setValue(value);
}

function zetKeuze_(context, row, header, value) {
  const column = context.headers[normaliseerKop_(header)];
  if (!column) throw new Error(`Kolom '${header}' ontbreekt.`);
  zetKeuzeOpCel_(context.sheet.getRange(row, column), value);
}

function zetKeuzeOpCel_(cell, value) {
  const allowed = toegestaneWaarden_(cell);
  if (!allowed) {
    cell.setValue(value);
    return;
  }
  const wanted = normaliseerTekst_(value);
  const match = allowed.find(option => normaliseerTekst_(option) === wanted) ||
    allowed.find(option => normaliseerTekst_(option).includes(wanted) || wanted.includes(normaliseerTekst_(option)));
  if (!match) throw new Error(`Waarde '${value}' staat niet in het dropdownmenu van ${cell.getA1Notation()}.`);
  cell.setValue(match);
}

function zetVinkje_(context, row, header, value) {
  const column = context.headers[normaliseerKop_(header)];
  if (!column) throw new Error(`Kolom '${header}' ontbreekt.`);
  zetVinkjeOpCel_(context.sheet.getRange(row, column), value);
}

function zetVinkjeOpCel_(cell, value) {
  const merged = cell.getMergedRanges();
  const target = merged.length ? merged[0] : cell;
  const rule = target.getDataValidation();
  if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
    target.insertCheckboxes();
  }
  target.setValue(Boolean(value));
  target.setHorizontalAlignment("center");
}

function maakSollicitatieVinkjes_(sheet) {
  const tempContext = haalContextVoorSetup_(sheet);
  const column = tempContext.headers.sollicitatiebehandelaar;
  if (!column) throw new Error("Kolom 'Sollicitatie behandelaar' ontbreekt.");
  for (let row = tempContext.firstRow; row <= tempContext.lastRow; row += 1) {
    const rank = sheet.getRange(row, tempContext.headers.rang).getDisplayValue();
    if (rank) zetVinkjeOpCel_(sheet.getRange(row, column), false);
  }
}

function haalContextVoorSetup_(sheet) {
  const values = sheet.getRange(1, 1, Math.min(25, sheet.getMaxRows()), sheet.getMaxColumns()).getDisplayValues();
  for (let r = 0; r < values.length; r += 1) {
    const headers = {};
    values[r].forEach((value, index) => {
      const key = normaliseerKop_(value);
      if (key) headers[key] = index + 1;
    });
    if (headers.rang && headers.discordid) {
      return { headers, firstRow: r + 2, lastRow: sheet.getLastRow() };
    }
  }
  throw new Error("Koppen niet gevonden tijdens setup.");
}

function toegestaneWaarden_(cell) {
  const rule = cell.getDataValidation();
  if (!rule) return null;
  const type = rule.getCriteriaType();
  const args = rule.getCriteriaValues();
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return args[0].map(String);
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) return args[0].getDisplayValues().flat().filter(Boolean).map(String);
  return null;
}

function haalLogblad_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(AFR_LOGBLAD);
  if (!sheet) sheet = spreadsheet.insertSheet(AFR_LOGBLAD);
  if (!sheet.getLastRow()) {
    sheet.appendRow(["Datum en tijd", "Actie", "Discord ID", "Naam", "Uitgevoerd door", "Resultaat"]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function schrijfLog_(spreadsheet, type, data, result) {
  const actor = [data.actorName, data.actorId ? `(${data.actorId})` : ""].filter(Boolean).join(" ");
  haalLogblad_(spreadsheet).appendRow([
    new Date(), type, String(data.discordId || ""), String(data.name || ""), actor,
    result && result.message ? result.message : JSON.stringify(result || {}),
  ]);
}

function parseDatum_(value) {
  if (!value) return new Date();
  const text = String(value);
  const dutch = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dutch) return new Date(Number(dutch[3]), Number(dutch[2]) - 1, Number(dutch[1]));
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error("Ongeldige datum. Gebruik DD-MM-JJJJ.");
  return parsed;
}

function normaliseerKop_(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normaliseerTekst_(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\bafr\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function normaliseerDiscordId_(value) {
  const match = String(value || "").match(/\d{17,20}/);
  return match ? match[0] : "";
}

function rangScore_(leftValue, rightValue) {
  const left = normaliseerTekst_(leftValue);
  const right = normaliseerTekst_(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.replace(/\s/g, "") === right.replace(/\s/g, "")) return 0.95;
  if (left.includes(right) || right.includes(left)) return 0.85;
  return 0;
}

function verplicht_(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(`${label} ontbreekt.`);
  }
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
