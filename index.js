const path = require("node:path");
const {
  AuditLogEvent,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

process.env.TZ = "Europe/Amsterdam";

const CONFIG = Object.freeze({
  attendanceChannelId: "1438602360095113390",
  overviewChannelId: "1537247199606608013",
  inactivityChannelId: "1537255726735691786",
  absenceChannelId: "1509628813628280842",
  attendanceArchiveChannelId: "1537265369352372346",
  warningChannelId: "1440369548388732949",
  spreadsheetAutomationRoleId: "1543023051967430676",
  spreadsheetStaffRankNames: [
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
  ],
  blacklistRoleIds: [
    "1542177617929703444",
    "1461807420740341835",
  ],
  terminationPreservedRoleIds: ["1218323042204385310"],
  acceptedChannelId: "1449466069613019217",
  absenceCommandRoleId: "1218521637368893471",
  warningCommandRoleId: "1537254102529085480",
  excludedUserIds: ["683032015045787676"],
  attendanceExemptRoleIds: [
    "1218521637368893471",
    "1518661886579707974",
    "1539684195159248916",
  ],
  rankRoleIds: [
    "1218521637368893471",
    "1518661886579707974",
    "1539684195159248916",
    "1492244526356758748",
    "1438207385587028119",
    "1469669109988987006",
    "1503083088148697320",
    "1437915250182848653",
    "1453080104019427441",
    "1503084773508124843",
    "1218521533606137926",
    "1440057853044850780",
    "1537250384572325889",
  ],
  timeZone: "Europe/Amsterdam",
  inactivityCutoffHour: 21,
  updateIntervalMs: 5 * 60 * 1000,
  attendanceDashboardMarker: "AFR-WEEKOVERZICHT",
  attendanceArchiveMarker: "AFR-WEEKARCHIEF",
  attendanceArchiveTestMarker: "AFR-WEEKARCHIEF-TEST",
  inactivityDashboardMarker: "AFR-INACTIVITEIT",
  manualAbsenceMarker: "AFR-HANDMATIG-AFWEZIG",
  removedAbsenceMarker: "AFR-AFWEZIG-VERWIJDERD",
  blacklistMarker: "AFR-BLACKLIST",
});

const absenceCommand = new SlashCommandBuilder()
  .setName("afwezig")
  .setDescription("Beheer handmatige afwezigheden.")
  .setDefaultMemberPermissions(0)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("toevoegen")
      .setDescription("Voeg iemand handmatig aan de afwezigheidslijst toe.")
      .addUserOption((option) =>
        option
          .setName("persoon")
          .setDescription("De persoon die afwezig is.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("begin")
          .setDescription("Begindatum en -tijd: DD-MM-JJJJ UU:MM")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("einde")
          .setDescription("Einddatum en -tijd: DD-MM-JJJJ UU:MM")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reden")
          .setDescription("De reden van de afwezigheid.")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("verwijderen")
      .setDescription("Haal iemand handmatig uit de afwezigheidslijst.")
      .addUserOption((option) =>
        option
          .setName("persoon")
          .setDescription("De persoon die uit de afwezigheidslijst moet.")
          .setRequired(true),
      ),
  );

const warningCommand = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Plaats een waarschuwing of ontslagmelding.")
  .setDefaultMemberPermissions(0)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName("type")
      .setDescription("Kies een waarschuwing of ontslag.")
      .setRequired(true)
      .addChoices(
        { name: "Waarschuwing", value: "waarschuwing" },
        { name: "Ontslagen", value: "ontslagen" },
      ),
  )
  .addRoleOption((option) =>
    option
      .setName("huidige_rang")
      .setDescription("De huidige rang van de persoon.")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reden")
      .setDescription("De reden voor de waarschuwing of het ontslag.")
      .setMaxLength(1000)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("bron")
      .setDescription("De verplichte bron of bewijsverwijzing.")
      .setMaxLength(1000)
      .setRequired(true),
  )
  .addUserOption((option) =>
    option
      .setName("persoon")
      .setDescription("Kies de persoon als die nog in Discord staat."),
  )
  .addStringOption((option) =>
    option
      .setName("naam")
      .setDescription("Losse naam of gebruikers-ID als de persoon al weg is.")
      .setMaxLength(100),
  )
  .addRoleOption((option) =>
    option
      .setName("sanctie")
      .setDescription("Sanctierol die bij een waarschuwing wordt gegeven."),
  );

const sheetTestCommand = new SlashCommandBuilder()
  .setName("sheettest")
  .setDescription("Controleer de spreadsheetkoppeling zonder gegevens te wijzigen.")
  .setDefaultMemberPermissions(0)
  .setDMPermission(false);

const warningRemoveCommand = new SlashCommandBuilder()
  .setName("warnweg")
  .setDescription("Trek een waarschuwing en de bijbehorende sanctierol in.")
  .setDefaultMemberPermissions(0)
  .setDMPermission(false)
  .addUserOption((option) =>
    option
      .setName("persoon")
      .setDescription("De persoon van wie de waarschuwing wordt ingetrokken.")
      .setRequired(true),
  )
  .addRoleOption((option) =>
    option
      .setName("sanctie")
      .setDescription("De sanctierol die bij deze waarschuwing hoort.")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reden")
      .setDescription("Waarom de waarschuwing wordt ingetrokken.")
      .setMaxLength(1000)
      .setRequired(true),
  );

const banCommand = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Verban een gebruiker via diens Discord-gebruikers-ID.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName("userid")
      .setDescription("De Discord-gebruikers-ID die verbannen moet worden.")
      .setMinLength(17)
      .setMaxLength(20)
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reden")
      .setDescription("De reden voor de ban.")
      .setMaxLength(450)
      .setRequired(true),
  );

const unbanCommand = new SlashCommandBuilder()
  .setName("unban")
  .setDescription("Hef een ban op via de Discord-gebruikers-ID.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName("userid")
      .setDescription("De Discord-gebruikers-ID waarvan de ban wordt opgeheven.")
      .setMinLength(17)
      .setMaxLength(20)
      .setRequired(true),
  );

const refreshInactivityCommand = new SlashCommandBuilder()
  .setName("werkbijinactiviteit")
  .setDescription("Werk het live inactiviteitsoverzicht direct bij.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const refreshActivityCommand = new SlashCommandBuilder()
  .setName("werkbijactiviteit")
  .setDescription("Werk het live activiteitsoverzicht direct bij.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const resetInactivityCommand = new SlashCommandBuilder()
  .setName("resetinactiviteit")
  .setDescription("Laat alle inactiviteitstellingen vanaf nu opnieuw beginnen.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const resetActivityCommand = new SlashCommandBuilder()
  .setName("resetactiviteit")
  .setDescription("Laat alle activiteitstellingen vanaf nu opnieuw beginnen.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const dashboardMessagesByMarker = new Map();
const dashboardResetTimestamps = new Map();
const blacklistUserIds = new Set();
let refreshInProgress = false;
let dashboardGuildId = null;
let archiveTestSentThisSession = false;
let spreadsheetConfigurationWarningShown = false;
let blacklistLoadPromise = null;

async function sendSpreadsheetEvent(type, data) {
  const webhookUrl = process.env.SHEET_WEBHOOK_URL;
  const webhookSecret = process.env.SHEET_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    if (!spreadsheetConfigurationWarningShown) {
      spreadsheetConfigurationWarningShown = true;
      console.warn(
        "Spreadsheetkoppeling staat uit: SHEET_WEBHOOK_URL of SHEET_WEBHOOK_SECRET ontbreekt.",
      );
    }
    return false;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: webhookSecret,
      type,
      sentAt: new Date().toISOString(),
      data,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Spreadsheet-webhook gaf HTTP ${response.status}: ${responseText.slice(0, 300)}`,
    );
  }

  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Spreadsheet-webhook gaf geen geldig JSON-antwoord.");
  }

  if (!result.ok) {
    throw new Error(result.error || "Spreadsheet-update is geweigerd.");
  }

  console.log(`Spreadsheet-update ${type} geslaagd.`);
  return result.result ?? true;
}

function queueSpreadsheetEvent(type, data) {
  void sendSpreadsheetEvent(type, data).catch((error) => {
    console.error(`Spreadsheet-update ${type} is mislukt:`, error);
  });
}

async function loadAllGuildMembers(guild) {
  let after;
  let fetchedCount = 0;

  while (true) {
    const members = await guild.members.list({
      after,
      limit: 1000,
      cache: true,
    });

    fetchedCount += members.size;

    if (members.size < 1000) break;

    const lastMember = members.last();

    if (!lastMember || lastMember.id === after) break;
    after = lastMember.id;
  }

  console.log(
    `Ledenlijst eenmalig geladen: ${guild.members.cache.size} leden in de cache (${fetchedCount} opgehaald).`,
  );
}

function getWeekPeriod(now = new Date()) {
  const current = new Date(now);
  const start = new Date(current);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(20, 0, 0, 0);

  if (current >= end) {
    start.setDate(start.getDate() + 7);
    end.setDate(end.getDate() + 7);
  }

  return {
    start,
    end,
  };
}

function getMostRecentCompletedWeek(now = new Date()) {
  const activePeriod = getWeekPeriod(now);
  const start = addLocalDays(activePeriod.start, -7);
  const end = addLocalDays(start, 6);
  end.setHours(20, 0, 0, 0);

  return { start, end };
}

function isWeeklyArchiveTime(now = new Date()) {
  return now.getDay() === 0 && now.getHours() >= 20;
}

function getMonthStart(now = new Date()) {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addLocalDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getLocalDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDutchDateTime(dateText, timeText, useEndOfDay = false) {
  const dateMatch = String(dateText || "").match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
  );

  if (!dateMatch) return null;

  const [, dayText, monthText, yearText] = dateMatch;
  const timeMatch = String(timeText || "").match(/^(\d{1,2}):(\d{2})$/);
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const hour = timeMatch ? Number(timeMatch[1]) : useEndOfDay ? 23 : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : useEndOfDay ? 59 : 0;

  if (hour > 23 || minute > 59) return null;

  const result = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }

  return result;
}

function parseCommandDateTime(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+(\d{1,2}:\d{2})$/);

  return match ? parseDutchDateTime(match[1], match[2]) : null;
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: CONFIG.timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatLocalTime(date) {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: CONFIG.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getInactivityDayCounts(
  lastActivityTimestamp,
  trackingStart,
  now = new Date(),
  absenceRecords = [],
) {
  const current = new Date(now);
  const hasActivity = Number.isFinite(lastActivityTimestamp);
  const baseline = new Date(
    hasActivity ? lastActivityTimestamp : trackingStart,
  );
  const firstCutoff = new Date(baseline);

  firstCutoff.setHours(CONFIG.inactivityCutoffHour, 0, 0, 0);

  if (hasActivity || baseline.getTime() > getMonthStart(baseline).getTime()) {
    firstCutoff.setDate(firstCutoff.getDate() + 1);
  }

  let missedDays = 0;
  let excusedDays = 0;
  let cutoff = firstCutoff;

  while (cutoff <= current) {
    const isExcused = absenceRecords.some(
      (record) =>
        !record.cancelled && record.start <= cutoff && record.end >= cutoff,
    );

    if (isExcused) {
      excusedDays += 1;
    } else {
      missedDays += 1;
    }

    cutoff = addLocalDays(cutoff, 1);
  }

  return { missedDays, excusedDays };
}

function getMissedDays(
  lastActivityTimestamp,
  trackingStart,
  now = new Date(),
  absenceRecords = [],
) {
  return getInactivityDayCounts(
    lastActivityTimestamp,
    trackingStart,
    now,
    absenceRecords,
  ).missedDays;
}

function getMentionedUserIds(content) {
  return new Set(
    [...content.matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]),
  );
}

function getMessageText(message) {
  const embedText = message.embeds.flatMap((embed) => [
    embed.title,
    embed.description,
    ...(embed.fields || []).flatMap((field) => [field.name, field.value]),
    embed.footer?.text,
  ]);

  return [message.content, ...embedText]
    .filter(Boolean)
    .join("\n")
    .replace(/\*\*/g, "");
}

function getBlacklistedUserId(message) {
  for (const embed of message.embeds || []) {
    const markerMatch = embed.footer?.text?.match(
      new RegExp(`${CONFIG.blacklistMarker}:(\\d{17,20})`, "i"),
    );

    if (markerMatch) return markerMatch[1];

    if (embed.title?.toLowerCase().startsWith("ontslagen")) {
      const legacyMatch = embed.description?.match(
        /(?:^|\n)>?\s*\*\*Naam:\*\*\s*(?:<@!?(\d{17,20})>|`?(\d{17,20})`?)/i,
      );

      if (legacyMatch) return legacyMatch[1] || legacyMatch[2];
    }
  }

  return null;
}

async function getConfiguredBlacklistRoles(guild) {
  const roles = await Promise.all(
    CONFIG.blacklistRoleIds.map(
      async (roleId) =>
        guild.roles.cache.get(roleId) ??
        (await guild.roles.fetch(roleId).catch(() => null)),
    ),
  );
  const missingRoleIds = CONFIG.blacklistRoleIds.filter(
    (_roleId, index) => !roles[index],
  );

  if (missingRoleIds.length > 0) {
    throw new Error(
      `Blacklistrol(len) niet gevonden: ${missingRoleIds.map((roleId) => `<@&${roleId}>`).join(", ")}.`,
    );
  }

  const botMember = guild.members.me;

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("De bot mist de machtiging `Rollen beheren`.");
  }

  const unmanageableRole = roles.find(
    (role) =>
      role.managed || role.position >= botMember.roles.highest.position,
  );

  if (unmanageableRole) {
    throw new Error(
      `De botrol moet boven blacklistrol <@&${unmanageableRole.id}> staan.`,
    );
  }

  return roles;
}

async function loadBlacklistUserIds(guild) {
  if (blacklistLoadPromise) return blacklistLoadPromise;

  blacklistLoadPromise = (async () => {
    const warningChannel = await client.channels.fetch(CONFIG.warningChannelId);

    if (!warningChannel?.isTextBased() || !warningChannel.messages) {
      throw new Error("Het waarschuwingenkanaal is geen tekstkanaal.");
    }

    if (warningChannel.guildId !== guild.id) {
      throw new Error("Het waarschuwingenkanaal staat niet in deze server.");
    }

    let before;

    while (true) {
      const messages = await warningChannel.messages.fetch({
        limit: 100,
        ...(before ? { before } : {}),
      });

      for (const message of messages.values()) {
        if (message.author.id !== client.user.id) continue;

        const userId = getBlacklistedUserId(message);

        if (userId) blacklistUserIds.add(userId);
      }

      if (messages.size < 100) break;

      const oldestMessage = messages.last();

      if (!oldestMessage || oldestMessage.id === before) break;
      before = oldestMessage.id;
    }

    console.log(
      `Blacklist geladen: ${blacklistUserIds.size} gebruiker(s) geregistreerd.`,
    );
    return blacklistUserIds;
  })().catch((error) => {
    blacklistLoadPromise = null;
    throw error;
  });

  return blacklistLoadPromise;
}

async function restoreBlacklistRoles(member, configuredRoles = null) {
  await loadBlacklistUserIds(member.guild);

  if (!blacklistUserIds.has(member.id)) return false;

  const blacklistRoles =
    configuredRoles || (await getConfiguredBlacklistRoles(member.guild));
  const missingRoles = blacklistRoles.filter(
    (role) => !member.roles.cache.has(role.id),
  );

  if (missingRoles.length === 0) return false;

  await member.roles.add(
    missingRoles,
    "Blacklistrollen automatisch hersteld na opnieuw joinen.",
  );
  console.log(
    `Blacklistrollen hersteld voor ${member.user.tag} (${member.id}).`,
  );
  return true;
}

async function restoreBlacklistRolesForGuild(guild) {
  await loadBlacklistUserIds(guild);

  if (blacklistUserIds.size === 0) return;

  const blacklistRoles = await getConfiguredBlacklistRoles(guild);
  let restoredCount = 0;

  for (const userId of blacklistUserIds) {
    const member =
      guild.members.cache.get(userId) ??
      (await guild.members.fetch(userId).catch(() => null));

    if (!member) continue;

    try {
      if (await restoreBlacklistRoles(member, blacklistRoles)) {
        restoredCount += 1;
      }
    } catch (error) {
      console.error(
        `Blacklistrollen konden niet worden hersteld voor ${userId}:`,
        error,
      );
    }
  }

  console.log(
    `Blacklistcontrole voltooid: ${restoredCount} lid/leden bijgewerkt.`,
  );
}

function getRoleSnapshot(member) {
  const rankRoleId = getMemberRankId(member);
  const rankRole = rankRoleId ? member.guild.roles.cache.get(rankRoleId) : null;

  return {
    discordId: member.id,
    name: member.displayName,
    rankRoleId,
    rankName: rankRole?.name || null,
  };
}

async function getRecentRoleChangeExecutor(guild, targetId) {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 6,
    });
    const now = Date.now();
    const entry = auditLogs.entries.find(
      (auditEntry) =>
        auditEntry.targetId === targetId &&
        now - auditEntry.createdTimestamp < 20_000,
    );

    return entry?.executor
      ? {
          id: entry.executor.id,
          name: entry.executor.globalName || entry.executor.username,
        }
      : null;
  } catch (error) {
    console.warn(
      "Uitvoerder van rolwijziging kon niet uit het auditlog worden gelezen:",
      error.message,
    );
    return null;
  }
}

function parseAcceptedMemberBlock_(text, messageId, recordIndex) {
  const discordId = getFormValue(text, "Discord ID").match(/\d{17,20}/)?.[0];
  const nameValue = getFormValue(text, "Naam");
  const mentionedNameId = nameValue.match(/<@!?(\d{17,20})>/)?.[1];
  const acceptedByValue = getFormValue(text, "Aangenomen door");
  const acceptedById = acceptedByValue.match(/<@!?(\d{17,20})>/)?.[1];
  const changedByValue =
    getFormValue(text, "Gewijzigd door") || getFormValue(text, "Tag");
  const changedByRoleId = changedByValue.match(/<@&\s*(\d{17,20})>/)?.[1];
  const changedById = changedByValue.match(/<@!?(\d{17,20})>/)?.[1];
  const staffRankValue = getFormValue(text, "Staff Rang");
  const staffRankId = staffRankValue.match(/<@&\s*(\d{17,20})>/)?.[1];
  const acceptedDate = getFormValue(text, "Datum aangenomen");
  const targetId = discordId || mentionedNameId;

  if (!targetId || !acceptedDate) return null;

  return {
    discordId: targetId,
    name: nameValue || `<@${targetId}>`,
    acceptedDate,
    acceptedById: acceptedById || null,
    acceptedByName: acceptedByValue || null,
    changedById: changedById || null,
    changedByName: changedByValue || null,
    changedByRoleId: changedByRoleId || null,
    staffRankId: staffRankId || null,
    staffRankName: staffRankValue || null,
    sourceMessageId: messageId,
    sourceRecordIndex: recordIndex,
  };
}

function parseAcceptedMemberMessages(message) {
  const text = getMessageText(message);
  const starts = [];
  const pattern = /(?:^|\n)\s*[>|]?\s*Naam:\s*/gim;
  let match;

  while ((match = pattern.exec(text))) {
    starts.push(match.index + (match[0].startsWith("\n") ? 1 : 0));
  }

  if (starts.length === 0) return [];

  return starts
    .map((start, index) =>
      parseAcceptedMemberBlock_(
        text.slice(start, starts[index + 1] ?? text.length),
        message.id,
        index,
      ),
    )
    .filter(Boolean);
}

function parseAcceptedMemberMessage(message) {
  return parseAcceptedMemberMessages(message)[0] || null;
}

function getCanonicalStaffRankName(value) {
  const normalizedValue = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return (
    CONFIG.spreadsheetStaffRankNames.find(
      (rankName) =>
        rankName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "") === normalizedValue,
    ) || null
  );
}

async function processAcceptedMessage(message) {
  if (message.channelId !== CONFIG.acceptedChannelId) return false;

  const fullMessage = message.partial
    ? await message.fetch().catch(() => null)
    : message;

  if (!fullMessage) return false;

  const acceptedMembers = parseAcceptedMemberMessages(fullMessage);
  if (acceptedMembers.length === 0) return false;

  const guild = fullMessage.guild;
  if (!guild) return false;

  await guild.roles.fetch().catch(() => undefined);

  for (const acceptedMember of acceptedMembers) {
    const member =
      guild.members.cache.get(acceptedMember.discordId) ??
      (await guild.members.fetch(acceptedMember.discordId).catch(() => null));
    const snapshot = member ? getRoleSnapshot(member) : {};
    const acceptedById = acceptedMember.acceptedById || fullMessage.author?.id;
    const acceptedByMember = acceptedById
      ? guild.members.cache.get(acceptedById) ??
        (await guild.members.fetch(acceptedById).catch(() => null))
      : null;
    const changedByMember = acceptedMember.changedById
      ? guild.members.cache.get(acceptedMember.changedById) ??
        (await guild.members
          .fetch(acceptedMember.changedById)
          .catch(() => null))
      : null;
    const staffRank = acceptedMember.staffRankId
      ? guild.roles.cache.get(acceptedMember.staffRankId)
      : null;
    const staffRankName = getCanonicalStaffRankName(
      staffRank?.name || acceptedMember.staffRankName,
    );
    const isAutomaticSystem =
      acceptedMember.changedByRoleId === CONFIG.spreadsheetAutomationRoleId;

    if (!staffRankName) {
      console.warn(
        `Onbekende Staff Rang in aangenomen-bericht ${fullMessage.id}: ${acceptedMember.staffRankName || "ontbreekt"}.`,
      );
    }

    queueSpreadsheetEvent("accepted", {
      ...acceptedMember,
      name: member?.displayName || acceptedMember.name,
      rankRoleId: snapshot.rankRoleId || null,
      rankName: snapshot.rankName || null,
      changedByRoleId:
        acceptedMember.changedByRoleId || CONFIG.spreadsheetAutomationRoleId,
      changedByName: isAutomaticSystem
        ? "Automatisch Systeem"
        : changedByMember?.displayName ||
          acceptedMember.changedByName ||
          "Automatisch Systeem",
      acceptedById: acceptedById || null,
      acceptedByName:
        acceptedByMember?.displayName ||
        acceptedMember.acceptedByName ||
        fullMessage.author?.globalName ||
        fullMessage.author?.username ||
        null,
      staffRankName:
        staffRankName || staffRank?.name || acceptedMember.staffRankName || null,
      changedAt: new Date(
        fullMessage.editedTimestamp || fullMessage.createdTimestamp,
      ).toISOString(),
    });
  }

  return true;
}

function getMarkedUserId(message, marker) {
  const markerPattern = new RegExp(`${marker}:(\\d{17,20})`, "i");
  return getMessageText(message).match(markerPattern)?.[1] || null;
}

function getFormValue(text, label) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*[>|]?\\s*${label}:\\s*([^\\n]+)`,
    "i",
  );
  return text.match(pattern)?.[1]?.trim() || "";
}

function parseAbsenceForm(message) {
  const text = getMessageText(message);
  const userId = getFormValue(text, "Naam").match(/<@!?(\d{17,20})>/)?.[1];
  const beginDateText = getFormValue(text, "Begin datum");
  const endDateText = getFormValue(text, "Eind datum");

  if (!userId || !beginDateText || !endDateText) return null;

  const beginTimeText =
    getFormValue(text, "Begin tijd") || beginDateText.match(/\d{1,2}:\d{2}/)?.[0];
  const endTimeText =
    getFormValue(text, "Eind tijd") || endDateText.match(/\d{1,2}:\d{2}/)?.[0];
  const beginDateOnly = beginDateText.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}/)?.[0];
  const endDateOnly = endDateText.match(/\d{1,2}[/-]\d{1,2}[/-]\d{4}/)?.[0];
  const start = parseDutchDateTime(beginDateOnly, beginTimeText, false);
  const end = parseDutchDateTime(endDateOnly, endTimeText, true);

  if (!start || !end || end < start) return null;

  return {
    userId,
    reason: getFormValue(text, "Reden") || "Geen reden opgegeven",
    start,
    end,
    sourceTimestamp: message.createdTimestamp,
    cancelled: false,
  };
}

function collectAbsenceRecords(messages, allowedMemberIds, monthStart) {
  const records = [];
  const orderedMessages = [...messages].sort(
    (messageA, messageB) =>
      messageA.createdTimestamp - messageB.createdTimestamp,
  );

  for (const message of orderedMessages) {
    const removedUserId = getMarkedUserId(
      message,
      CONFIG.removedAbsenceMarker,
    );

    if (removedUserId) {
      for (const record of records) {
        if (record.userId === removedUserId) record.cancelled = true;
      }
      continue;
    }

    const record = parseAbsenceForm(message);

    if (record && allowedMemberIds.has(record.userId)) records.push(record);
  }

  const absencesByMember = new Map(
    [...allowedMemberIds].map((memberId) => [memberId, []]),
  );

  for (const record of records) {
    if (
      !record.cancelled &&
      (record.sourceTimestamp >= monthStart.getTime() || record.end >= monthStart)
    ) {
      absencesByMember.get(record.userId).push(record);
    }
  }

  for (const memberAbsences of absencesByMember.values()) {
    memberAbsences.sort((absenceA, absenceB) =>
      absenceB.start - absenceA.start,
    );
  }

  return absencesByMember;
}

async function fetchMessagesSince(channel, startTimestamp) {
  const messages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });

    if (batch.size === 0) break;

    const ordered = [...batch.values()].sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp,
    );

    for (const message of ordered) {
      if (message.createdTimestamp >= startTimestamp) messages.push(message);
    }

    const oldestMessage = ordered.at(-1);

    if (
      batch.size < 100 ||
      oldestMessage.createdTimestamp < startTimestamp
    ) {
      break;
    }

    before = oldestMessage.id;
  }

  return messages;
}

function collectAttendance(messages, allowedMemberIds) {
  const attendance = new Map(
    [...allowedMemberIds].map((memberId) => [memberId, new Set()]),
  );

  for (const message of messages) {
    const messageDate = new Date(message.createdTimestamp);
    const dateKey = getLocalDateKey(messageDate);

    for (const memberId of getMentionedUserIds(message.content)) {
      if (attendance.has(memberId)) attendance.get(memberId).add(dateKey);
    }
  }

  return attendance;
}

function collectLatestActivity(messages, allowedMemberIds) {
  const latestActivity = new Map(
    [...allowedMemberIds].map((memberId) => [memberId, null]),
  );

  for (const message of messages) {
    for (const memberId of getMentionedUserIds(message.content)) {
      if (!latestActivity.has(memberId)) continue;

      const currentTimestamp = latestActivity.get(memberId);

      if (
        currentTimestamp === null ||
        message.createdTimestamp > currentTimestamp
      ) {
        latestActivity.set(memberId, message.createdTimestamp);
      }
    }
  }

  return latestActivity;
}

function formatAttendanceDates(dateKeys) {
  return [...dateKeys]
    .sort()
    .map((dateKey) => {
      const [year, month, day] = dateKey.split("-").map(Number);

      return new Intl.DateTimeFormat("nl-NL", {
        timeZone: CONFIG.timeZone,
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      }).format(new Date(year, month - 1, day, 12));
    })
    .join(", ");
}

function getMemberRankId(member) {
  return CONFIG.rankRoleIds.find((roleId) => member.roles.cache.has(roleId));
}

function formatAttendanceMemberLine(member, attendance) {
  if (CONFIG.attendanceExemptRoleIds.includes(getMemberRankId(member))) {
    return `✨ <@${member.id}> — **Geen Aanwezigheid Nodig!**`;
  }

  const dates = attendance.get(member.id);
  const count = dates.size;
  const icon =
    count >= 5 ? "👑" : count >= 3 ? "🟢" : count === 2 ? "🟠" : "🔴";
  const dateText = count > 0 ? ` · ${formatAttendanceDates(dates)}` : "";

  return `${icon} <@${member.id}> — **${count}/7 dagen**${dateText}`;
}

function buildRankLines(members, formatLine, getSortScore) {
  const groups = new Map(
    CONFIG.rankRoleIds.map((roleId) => [roleId, []]),
  );

  for (const member of members) {
    groups.get(getMemberRankId(member)).push(member);
  }

  const lines = [];

  for (const [rankIndex, roleId] of CONFIG.rankRoleIds.entries()) {
    const rankMembers = groups.get(roleId).sort((memberA, memberB) => {
      if (CONFIG.attendanceExemptRoleIds.includes(roleId)) {
        return memberA.displayName.localeCompare(memberB.displayName, "nl");
      }

      const countDifference =
        getSortScore(memberB) - getSortScore(memberA);

      return (
        countDifference ||
        memberA.displayName.localeCompare(memberB.displayName, "nl")
      );
    });

    if (lines.length > 0) lines.push("");
    lines.push(`### ${rankIndex + 1}. <@&${roleId}>`);

    if (rankMembers.length === 0) {
      lines.push("*Geen leden met deze rang.*");
      continue;
    }

    lines.push(...rankMembers.map(formatLine));
  }

  return lines;
}

function chunkLines(lines, maximumLength = 3_500) {
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const line of lines) {
    if (
      currentChunk.length >= 30 ||
      currentLength + line.length + 1 > maximumLength
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(line);
    currentLength += line.length + 1;
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);

  return chunks.length > 0 ? chunks : [["Er zijn geen leden met deze rol."]];
}

function buildAttendanceDashboardEmbeds(
  members,
  attendance,
  period,
  messageCount,
  mode = "live",
  now = new Date(),
  resetAt = null,
) {
  const allMembers = [...members];
  const lines = buildRankLines(
    allMembers,
    (member) => formatAttendanceMemberLine(member, attendance),
    (member) => attendance.get(member.id).size,
  );
  const chunks = chunkLines(lines);
  const attendanceRequiredMembers = allMembers.filter(
    (member) =>
      !CONFIG.attendanceExemptRoleIds.includes(getMemberRankId(member)),
  );
  const exemptCount = allMembers.length - attendanceRequiredMembers.length;
  const presentCount = attendanceRequiredMembers.filter(
    (member) => attendance.get(member.id).size > 0,
  ).length;
  const updatedAt = Math.floor(now.getTime() / 1_000);
  const startAt = Math.floor(period.start.getTime() / 1_000);
  const endAt = Math.floor(period.end.getTime() / 1_000);
  const avatarUrl = client.user.displayAvatarURL({ size: 256 });
  const isArchive = mode === "archive";
  const isTest = mode === "test";
  const isFixedOverview = isArchive || isTest;

  return chunks.map((chunk, index) => {
    const isFirstPage = index === 0;
    const isLastPage = index === chunks.length - 1;
    const summary = isFirstPage
      ? [
          isTest
            ? "🧪 **Dit is een testbericht. Je mag dit bericht verwijderen.** Zo ziet het definitieve weekarchief er op zondag uit."
            : isArchive
              ? "Dit is het definitief opgeslagen weekoverzicht van vóór de zondagreset. Dit bericht wordt niet meer live aangepast."
              : "Alle Event Team-leden staan hieronder op rang gesorteerd. Iemand met meerdere rangen staat alleen onder de hoogste rang. Iedere persoon telt maximaal één keer per dag.",
          "",
          `**Aanwezig deze week:** ${presentCount}/${attendanceRequiredMembers.length}`,
          `**Geen aanwezigheid nodig:** ${exemptCount} leden`,
          `**Periode:** <t:${startAt}:f> tot <t:${endAt}:f>`,
          ...(resetAt
            ? [
                `**Handmatig opnieuw gestart:** <t:${Math.floor(resetAt / 1_000)}:f>`,
              ]
            : []),
          isFixedOverview
            ? `**Vastgelegd:** <t:${updatedAt}:f>`
            : `**Automatische reset:** <t:${endAt}:R>`,
          "",
          "**Beoordeling**",
          "1. 👑 **5/7 dagen**",
          "2. 🟢 **3/7 dagen**",
          "3. 🟠 **2/7 dagen**",
          "4. 🔴 **1/7 dagen**",
          "",
        ]
      : [];

    const embed = new EmbedBuilder()
      .setColor(0xd7ff00)
      .setDescription([...summary, ...chunk].join("\n"));

    if (isFirstPage) {
      embed
        .setAuthor({ name: "Event Team", iconURL: avatarUrl })
        .setTitle(
          isTest
            ? "🧪 TEST – weekarchief"
            : isArchive
              ? "🗃️ Definitief weekoverzicht"
              : "📋 Wekelijks aanwezigheidsoverzicht",
        )
        .setThumbnail(avatarUrl);
    }

    if (isLastPage) {
      const footerText = isTest
        ? `${CONFIG.attendanceArchiveTestMarker} • testbericht • mag verwijderd worden`
        : isArchive
          ? `${CONFIG.attendanceArchiveMarker}:${getLocalDateKey(period.start)} • definitief opgeslagen • ${messageCount} berichten verwerkt`
          : `${CONFIG.attendanceDashboardMarker} • ${messageCount} berichten verwerkt • iedere 5 minuten live bijgewerkt${resetAt ? ` • reset:${resetAt}` : ""}`;

      embed.setFooter({
        text: footerText,
      });
      embed.setTimestamp(updatedAt * 1_000);
    }

    return embed;
  });
}

function getMemberInactivity(
  member,
  latestActivity,
  absences,
  monthStart,
  now,
) {
  const lastActivityTimestamp = latestActivity.get(member.id);
  const trackingStart = new Date(
    Math.max(monthStart.getTime(), member.joinedTimestamp || 0),
  );
  const { missedDays, excusedDays } = getInactivityDayCounts(
    lastActivityTimestamp,
    trackingStart,
    now,
    absences.get(member.id) || [],
  );

  return {
    lastActivityTimestamp,
    missedDays,
    excusedDays,
  };
}

function formatAbsenceRecord(record, now) {
  const startAt = Math.floor(record.start.getTime() / 1_000);
  const endAt = Math.floor(record.end.getTime() / 1_000);
  const status =
    now < record.start
      ? "🗓️ Gepland"
      : now <= record.end
        ? "🛌 Nu afwezig"
        : "⚪ Afgelopen";
  const reason = record.reason.replace(/\s+/g, " ").slice(0, 120);

  return `↳ ${status} · **Begin:** <t:${startAt}:f> · **Einde:** <t:${endAt}:f> · **Reden:** ${reason}`;
}

function getVisibleAbsenceRecords(records, now = new Date()) {
  return records.filter((record) => record.end >= now);
}

function formatInactivityMemberLine(
  member,
  inactivity,
  absences,
  now,
  resetAt = null,
) {
  const absenceLines = getVisibleAbsenceRecords(
    absences.get(member.id) || [],
    now,
  ).map((record) => formatAbsenceRecord(record, now));

  if (CONFIG.attendanceExemptRoleIds.includes(getMemberRankId(member))) {
    return [
      `✨ <@${member.id}> — **Geen Inactiviteit bijhouden!**`,
      ...absenceLines,
    ].join("\n");
  }

  const { lastActivityTimestamp, missedDays, excusedDays } =
    inactivity.get(member.id);
  const excusedText = excusedDays
    ? ` · ${excusedDays} ${excusedDays === 1 ? "afwezigheidsdag" : "afwezigheidsdagen"} niet meegeteld`
    : "";

  if (missedDays >= 2) {
    const lastSeenText = lastActivityTimestamp
      ? ` · laatst meegedaan <t:${Math.floor(lastActivityTimestamp / 1_000)}:R>`
      : resetAt
        ? " · sinds de laatste reset nog niet meegedaan"
        : " · deze maand nog niet meegedaan";

    return [
      `🔴 <@${member.id}> — **${missedDays} dagen inactief**${lastSeenText}${excusedText}`,
      ...absenceLines,
    ].join("\n");
  }

  const lastSeenText = lastActivityTimestamp
    ? ` · laatst meegedaan <t:${Math.floor(lastActivityTimestamp / 1_000)}:R>`
    : resetAt
      ? " · sinds de laatste reset nog niet meegedaan"
      : " · deze maand nog niet meegedaan";

  return [
    `🟢 <@${member.id}> — **Actief** · ${missedDays}/2 gemiste dagen${lastSeenText}${excusedText}`,
    ...absenceLines,
  ].join("\n");
}

function buildInactivityDashboardEmbeds(
  members,
  latestActivity,
  absences,
  trackingStart,
  messageCount,
  now = new Date(),
  resetAt = null,
) {
  const allMembers = [...members];
  const inactivity = new Map(
    allMembers.map((member) => [
      member.id,
      getMemberInactivity(member, latestActivity, absences, trackingStart, now),
    ]),
  );
  const lines = buildRankLines(
    allMembers,
    (member) =>
      formatInactivityMemberLine(member, inactivity, absences, now, resetAt),
    (member) => inactivity.get(member.id).missedDays,
  );
  const chunks = chunkLines(lines);
  const trackedMembers = allMembers.filter(
    (member) =>
      !CONFIG.attendanceExemptRoleIds.includes(getMemberRankId(member)),
  );
  const exemptCount = allMembers.length - trackedMembers.length;
  const inactiveCount = trackedMembers.filter(
    (member) => inactivity.get(member.id).missedDays >= 2,
  ).length;
  const reportedAbsentCount = trackedMembers.filter((member) =>
    (absences.get(member.id) || []).some(
      (record) => record.start <= now && record.end >= now,
    ),
  ).length;
  const updatedAt = Math.floor(now.getTime() / 1_000);
  const trackingStartAt = Math.floor(trackingStart.getTime() / 1_000);
  const avatarUrl = client.user.displayAvatarURL({ size: 256 });

  return chunks.map((chunk, index) => {
    const isFirstPage = index === 0;
    const isLastPage = index === chunks.length - 1;
    const summary = isFirstPage
      ? [
          "Dit overzicht is gekoppeld aan dezelfde aanwezigheidsberichten. Een deelname zet de inactiviteit direct terug naar nul.",
          "Geregistreerde afwezigheids- en vakantiedagen tellen niet mee bij de dagelijkse peiling van 21:00 uur.",
          "",
          `**Inactief:** ${inactiveCount}/${trackedMembers.length}`,
          `**Momenteel afwezig gemeld:** ${reportedAbsentCount} leden`,
          `**Geen inactiviteit bijhouden:** ${exemptCount} leden`,
          `**Meten vanaf:** <t:${trackingStartAt}:f>`,
          ...(resetAt
            ? [
                `**Handmatig opnieuw gestart:** <t:${Math.floor(resetAt / 1_000)}:f>`,
              ]
            : []),
          `**Dagelijkse peiling:** 21:00 uur`,
          "**Inactief vanaf:** 2 gemiste dagen achter elkaar",
          "",
        ]
      : [];

    const embed = new EmbedBuilder()
      .setColor(0xff4d4d)
      .setDescription([...summary, ...chunk].join("\n"));

    if (isFirstPage) {
      embed
        .setAuthor({ name: "Event Team", iconURL: avatarUrl })
        .setTitle("⏳ Inactiviteitsoverzicht")
        .setThumbnail(avatarUrl);
    }

    if (isLastPage) {
      embed.setFooter({
        text: `${CONFIG.inactivityDashboardMarker} • ${messageCount} berichten verwerkt • iedere 5 minuten live bijgewerkt${resetAt ? ` • reset:${resetAt}` : ""}`,
      });
      embed.setTimestamp(updatedAt * 1_000);
    }

    return embed;
  });
}

async function findDashboardMessages(channel, marker) {
  const recentMessages = await channel.messages.fetch({ limit: 100 });

  return [...recentMessages.values()]
    .filter(
      (message) =>
        message.author.id === client.user.id &&
        message.embeds.some((embed) =>
          embed.footer?.text?.startsWith(marker),
        ),
    )
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function getDashboardResetTimestamp(channel, marker) {
  if (dashboardResetTimestamps.has(marker)) {
    return dashboardResetTimestamps.get(marker);
  }

  let dashboardMessages = dashboardMessagesByMarker.get(marker);

  if (!dashboardMessages) {
    dashboardMessages = await findDashboardMessages(channel, marker);
    dashboardMessagesByMarker.set(marker, dashboardMessages);
  }

  const resetAt = dashboardMessages
    .flatMap((message) => message.embeds)
    .map((embed) => embed.footer?.text?.match(/(?:^| • )reset:(\d{10,13})(?:$| • )/)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite)
    .at(-1) ?? null;

  dashboardResetTimestamps.set(marker, resetAt);
  return resetAt;
}

async function publishDashboard(channel, embeds, marker) {
  let dashboardMessages = dashboardMessagesByMarker.get(marker);

  if (!dashboardMessages) {
    dashboardMessages = await findDashboardMessages(channel, marker);
  }

  const payload = {
    embeds,
    allowedMentions: { parse: [] },
  };
  const dashboardMessage = dashboardMessages[0]
    ? await dashboardMessages[0].edit(payload)
    : await channel.send(payload);

  for (const extraMessage of dashboardMessages.slice(1)) {
    await extraMessage.delete().catch(() => undefined);
  }

  dashboardMessagesByMarker.set(marker, [dashboardMessage]);
}

async function publishAttendanceArchive(
  archiveChannel,
  members,
  attendance,
  period,
  messageCount,
  now,
) {
  const marker = `${CONFIG.attendanceArchiveMarker}:${getLocalDateKey(period.start)}`;
  const existingMessages = await findDashboardMessages(
    archiveChannel,
    marker,
  );

  if (existingMessages.length > 0) return false;

  const embeds = buildAttendanceDashboardEmbeds(
    members,
    attendance,
    period,
    messageCount,
    "archive",
    now,
  );

  await archiveChannel.send({
    embeds,
    allowedMentions: { parse: [] },
  });
  console.log(`Weekarchief ${getLocalDateKey(period.start)} opgeslagen.`);
  return true;
}

async function publishAttendanceArchiveTest(
  archiveChannel,
  members,
  attendance,
  period,
  messageCount,
  now,
) {
  if (archiveTestSentThisSession) return false;

  const existingMessages = await findDashboardMessages(
    archiveChannel,
    CONFIG.attendanceArchiveTestMarker,
  );

  archiveTestSentThisSession = true;
  if (existingMessages.length > 0) return false;

  const embeds = buildAttendanceDashboardEmbeds(
    members,
    attendance,
    period,
    messageCount,
    "test",
    now,
  );

  await archiveChannel.send({
    embeds,
    allowedMentions: { parse: [] },
  });
  console.log("Testbericht voor het weekarchief geplaatst.");
  return true;
}

async function refreshDashboard(scope = "both") {
  if (refreshInProgress) return { ok: false, busy: true };
  refreshInProgress = true;

  const updateAttendance = scope === "both" || scope === "attendance";
  const updateInactivity = scope === "both" || scope === "inactivity";

  try {
    const [
      attendanceChannel,
      overviewChannel,
      inactivityChannel,
      absenceChannel,
      archiveChannel,
    ] =
      await Promise.all([
        client.channels.fetch(CONFIG.attendanceChannelId),
        client.channels.fetch(CONFIG.overviewChannelId),
        client.channels.fetch(CONFIG.inactivityChannelId),
        client.channels.fetch(CONFIG.absenceChannelId),
        client.channels.fetch(CONFIG.attendanceArchiveChannelId),
      ]);

    if (!attendanceChannel?.isTextBased() || !attendanceChannel.messages) {
      throw new Error("Het aanwezigheidskanaal is geen tekstkanaal.");
    }

    if (!overviewChannel?.isTextBased() || !overviewChannel.messages) {
      throw new Error("Het overzichtskanaal is geen tekstkanaal.");
    }

    if (!inactivityChannel?.isTextBased() || !inactivityChannel.messages) {
      throw new Error("Het inactiviteitskanaal is geen tekstkanaal.");
    }

    if (!absenceChannel?.isTextBased() || !absenceChannel.messages) {
      throw new Error("Het afwezigheidskanaal is geen tekstkanaal.");
    }

    if (!archiveChannel?.isTextBased() || !archiveChannel.messages) {
      throw new Error("Het weekarchiefkanaal is geen tekstkanaal.");
    }

    const guild = attendanceChannel.guild;

    if (
      !guild ||
      overviewChannel.guildId !== guild.id ||
      inactivityChannel.guildId !== guild.id ||
      absenceChannel.guildId !== guild.id ||
      archiveChannel.guildId !== guild.id
    ) {
      throw new Error("De kanalen moeten in dezelfde Discord-server staan.");
    }

    const members = guild.members.cache.filter(
      (member) =>
        !member.user.bot &&
        !CONFIG.excludedUserIds.includes(member.id) &&
        CONFIG.rankRoleIds.some((roleId) => member.roles.cache.has(roleId)),
    );
    const now = new Date();
    const period = getWeekPeriod(now);
    const monthStart = getMonthStart(now);
    const [storedAttendanceResetAt, storedInactivityResetAt] =
      await Promise.all([
        getDashboardResetTimestamp(
          overviewChannel,
          CONFIG.attendanceDashboardMarker,
        ),
        getDashboardResetTimestamp(
          inactivityChannel,
          CONFIG.inactivityDashboardMarker,
        ),
      ]);
    const attendanceResetAt =
      storedAttendanceResetAt >= period.start.getTime() &&
      storedAttendanceResetAt <= now.getTime()
        ? storedAttendanceResetAt
        : null;
    const inactivityResetAt =
      storedInactivityResetAt >= monthStart.getTime() &&
      storedInactivityResetAt <= now.getTime()
        ? storedInactivityResetAt
        : null;

    dashboardResetTimestamps.set(
      CONFIG.attendanceDashboardMarker,
      attendanceResetAt,
    );
    dashboardResetTimestamps.set(
      CONFIG.inactivityDashboardMarker,
      inactivityResetAt,
    );

    const attendanceStart = new Date(
      Math.max(period.start.getTime(), attendanceResetAt || 0),
    );
    const inactivityTrackingStart = new Date(
      Math.max(monthStart.getTime(), inactivityResetAt || 0),
    );
    const archivePeriod = isWeeklyArchiveTime(now)
      ? getMostRecentCompletedWeek(now)
      : null;
    const absenceScanStart = new Date(monthStart);
    absenceScanStart.setMonth(absenceScanStart.getMonth() - 1);
    const scanStart = Math.min(
      period.start.getTime(),
      monthStart.getTime(),
      archivePeriod?.start.getTime() ?? Number.POSITIVE_INFINITY,
    );
    const [messages, absenceMessages] = await Promise.all([
      fetchMessagesSince(attendanceChannel, scanStart),
      fetchMessagesSince(absenceChannel, absenceScanStart.getTime()),
    ]);
    const weeklyMessages = messages.filter(
      (message) =>
        message.createdTimestamp >= attendanceStart.getTime() &&
        message.createdTimestamp < period.end.getTime(),
    );
    const monthlyMessages = messages.filter(
      (message) =>
        message.createdTimestamp >= inactivityTrackingStart.getTime(),
    );
    const memberIds = new Set(members.keys());
    const attendance = collectAttendance(weeklyMessages, memberIds);
    const latestActivity = collectLatestActivity(monthlyMessages, memberIds);
    const absences = collectAbsenceRecords(
      absenceMessages,
      memberIds,
      monthStart,
    );
    const attendanceEmbeds = updateAttendance
      ? buildAttendanceDashboardEmbeds(
          members.values(),
          attendance,
          { ...period, start: attendanceStart },
          weeklyMessages.length,
          "live",
          now,
          attendanceResetAt,
        )
      : null;
    const inactivityEmbeds = updateInactivity
      ? buildInactivityDashboardEmbeds(
          members.values(),
          latestActivity,
          absences,
          inactivityTrackingStart,
          absenceMessages.length,
          now,
          inactivityResetAt,
        )
      : null;

    if (scope === "both") {
      await publishAttendanceArchiveTest(
        archiveChannel,
        members.values(),
        attendance,
        period,
        weeklyMessages.length,
        now,
      );
    }

    if (scope === "both" && archivePeriod) {
      const archiveMessages = messages.filter(
        (message) =>
          message.createdTimestamp >= archivePeriod.start.getTime() &&
          message.createdTimestamp < archivePeriod.end.getTime(),
      );
      const archiveAttendance = collectAttendance(
        archiveMessages,
        memberIds,
      );

      await publishAttendanceArchive(
        archiveChannel,
        members.values(),
        archiveAttendance,
        archivePeriod,
        archiveMessages.length,
        now,
      );
    }

    if (updateAttendance) {
      await publishDashboard(
        overviewChannel,
        attendanceEmbeds,
        CONFIG.attendanceDashboardMarker,
      );
    }

    if (updateInactivity) {
      await publishDashboard(
        inactivityChannel,
        inactivityEmbeds,
        CONFIG.inactivityDashboardMarker,
      );
    }

    const updatedOverview =
      scope === "attendance"
        ? "Activiteitsoverzicht"
        : scope === "inactivity"
          ? "Inactiviteitsoverzicht"
          : "Activiteits- en inactiviteitsoverzicht";
    console.log(
      `${updatedOverview} bijgewerkt: ${members.size} leden, ${monthlyMessages.length} aanwezigheidsberichten en ${absenceMessages.length} afwezigheidsberichten.`,
    );
    return { ok: true };
  } catch (error) {
    console.error("De dashboards konden niet worden bijgewerkt:", error);
    return { ok: false, error };
  } finally {
    refreshInProgress = false;
  }
}

function scheduleDashboardUpdates() {
  const delayUntilNextUpdate =
    CONFIG.updateIntervalMs - (Date.now() % CONFIG.updateIntervalMs);

  setTimeout(() => {
    void refreshDashboard();
    setInterval(() => void refreshDashboard(), CONFIG.updateIntervalMs);
  }, delayUntilNextUpdate);
}

async function registerCommands(guild) {
  const commands = await guild.commands.fetch();
  const commandBuilders = [
    absenceCommand,
    warningCommand,
    warningRemoveCommand,
    banCommand,
    unbanCommand,
    refreshInactivityCommand,
    refreshActivityCommand,
    resetInactivityCommand,
    resetActivityCommand,
    sheetTestCommand,
  ];

  for (const commandBuilder of commandBuilders) {
    const existingCommand = commands.find(
      (command) => command.name === commandBuilder.name,
    );
    const commandData = commandBuilder.toJSON();

    if (existingCommand) {
      await existingCommand.edit(commandData);
    } else {
      await guild.commands.create(commandData);
    }
  }

  console.log(
    "Slash-commands /afwezig, /warn, /warnweg, /ban, /unban, /werkbijinactiviteit, /werkbijactiviteit, /resetinactiviteit, /resetactiviteit en /sheettest zijn geregistreerd.",
  );
}

async function handleSheetTestCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== sheetTestCommand.name
  ) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.inGuild()) {
      throw new Error("Deze command werkt alleen in de Discord-server.");
    }

    const executor =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id));

    if (!executor.roles.cache.has(CONFIG.warningCommandRoleId)) {
      throw new Error(
        `Alleen leden met <@&${CONFIG.warningCommandRoleId}> mogen deze command gebruiken.`,
      );
    }

    const result = await sendSpreadsheetEvent("ping", {
      actorId: interaction.user.id,
      actorName: interaction.user.username,
    });

    if (!result) {
      throw new Error(
        "SHEET_WEBHOOK_URL of SHEET_WEBHOOK_SECRET ontbreekt bij de hosting.",
      );
    }

    await interaction.editReply(
      [
        "✅ **Spreadsheetverbinding werkt**",
        `**Spreadsheet-ID:** \`${result.spreadsheetId}\``,
        `**Tabblad:** \`${result.sheetName}\``,
        `**Kopregel:** ${result.headerRow}`,
        `**Laatste gebruikte rij:** ${result.lastDataRow}`,
        "Er zijn geen cellen gewijzigd.",
      ].join("\n"),
    );
  } catch (error) {
    await interaction.editReply(`❌ Spreadsheettest mislukt: ${error.message}`);
  }
}

function getRemovableRoleIds(
  member,
  botMember,
  excludedRoleIds = new Set(),
) {
  const botHighestPosition = botMember.roles.highest.position;

  return member.roles.cache
    .filter(
      (role) =>
        role.id !== member.guild.id &&
        !role.managed &&
        role.position < botHighestPosition &&
        !excludedRoleIds.has(role.id),
    )
    .map((role) => role.id);
}

function cleanEmbedValue(value, maximumLength = 1000) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

async function resolveWarningTarget(interaction) {
  const selectedUser = interaction.options.getUser("persoon");
  const typedName = cleanEmbedValue(interaction.options.getString("naam"), 100);

  if ((selectedUser && typedName) || (!selectedUser && !typedName)) {
    throw new Error("Vul precies één van `persoon` of `naam` in.");
  }

  const typedUserId = typedName.match(/^\d{17,20}$/)?.[0];
  const userId = selectedUser?.id || typedUserId;
  let member = userId
    ? interaction.guild.members.cache.get(userId) || null
    : null;

  if (!member && selectedUser) {
    member = await interaction.guild.members
      .fetch(selectedUser.id)
      .catch(() => null);
  }

  if (!member && typedUserId) {
    member = await interaction.guild.members
      .fetch(typedUserId)
      .catch(() => null);
  }

  return {
    member,
    userId,
    display: userId ? `<@${userId}>` : typedName,
  };
}

async function handleWarningCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== warningCommand.name
  ) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.inGuild()) {
      throw new Error("Deze command werkt alleen in de Discord-server.");
    }

    const executor =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id));

    if (!executor.roles.cache.has(CONFIG.warningCommandRoleId)) {
      throw new Error(
        `Alleen leden met <@&${CONFIG.warningCommandRoleId}> mogen deze command gebruiken.`,
      );
    }

    const type = interaction.options.getString("type", true);
    const currentRank = interaction.options.getRole("huidige_rang", true);
    const reason = cleanEmbedValue(
      interaction.options.getString("reden", true),
    );
    const source = cleanEmbedValue(
      interaction.options.getString("bron", true),
    );
    const sanctionRole = interaction.options.getRole("sanctie");
    const target = await resolveWarningTarget(interaction);
    const botMember = interaction.guild.members.me;

    if (!botMember) {
      throw new Error("De eigen botrol kon niet worden gevonden.");
    }

    const warningChannel = await client.channels.fetch(CONFIG.warningChannelId);

    if (!warningChannel?.isTextBased() || !warningChannel.messages) {
      throw new Error("Het waarschuwingenkanaal is geen tekstkanaal.");
    }

    if (warningChannel.guildId !== interaction.guildId) {
      throw new Error("Het waarschuwingenkanaal staat niet in deze server.");
    }

    let sanctionText;
    let appliedSanctionRoleIds = [];
    let appliedSanctionNames = [];

    if (type === "waarschuwing") {
      if (!target.member) {
        throw new Error(
          "Voor een waarschuwing moet je een persoon kiezen die nog in de server zit.",
        );
      }

      if (!sanctionRole) {
        throw new Error("Bij een waarschuwing is `sanctie` verplicht.");
      }

      if (
        sanctionRole.id === interaction.guild.id ||
        sanctionRole.managed ||
        sanctionRole.position >= botMember.roles.highest.position
      ) {
        throw new Error(
          "De sanctierol moet een normale rol onder de hoogste botrol zijn.",
        );
      }

      await target.member.roles.add(
        sanctionRole,
        `Waarschuwing door ${interaction.user.tag}: ${reason}`,
      );
      sanctionText = `<@&${sanctionRole.id}> — toegekend`;
      appliedSanctionRoleIds = [sanctionRole.id];
      appliedSanctionNames = [sanctionRole.name];
    } else {
      if (sanctionRole) {
        throw new Error(
          "Kies bij ontslag geen sanctierol; de blacklistrollen worden automatisch toegekend.",
        );
      }

      if (!target.userId) {
        throw new Error(
          "Kies bij ontslag een persoon of vul diens Discord-gebruikers-ID in, zodat de blacklist bewaard kan worden.",
        );
      }

      const blacklistRoles = await getConfiguredBlacklistRoles(
        interaction.guild,
      );
      const protectedRoleIds = new Set([
        ...CONFIG.blacklistRoleIds,
        ...CONFIG.terminationPreservedRoleIds,
      ]);
      appliedSanctionRoleIds = blacklistRoles.map((role) => role.id);
      appliedSanctionNames = blacklistRoles.map((role) => role.name);

      if (target.member) {
        await target.member.roles.add(
          blacklistRoles,
          `Blacklist na ontslag door ${interaction.user.tag}: ${reason}`,
        );

        const removableRoleIds = getRemovableRoleIds(
          target.member,
          botMember,
          protectedRoleIds,
        );

        if (removableRoleIds.length > 0) {
          await target.member.roles.remove(
            removableRoleIds,
            `Ontslagen door ${interaction.user.tag}: ${reason}`,
          );
        }

        const preservedRoleMentions = CONFIG.terminationPreservedRoleIds
          .filter((roleId) => target.member.roles.cache.has(roleId))
          .map((roleId) => `<@&${roleId}>`);
        sanctionText = `${blacklistRoles.map((role) => `<@&${role.id}>`).join(" en ")} toegekend; ${removableRoleIds.length} verwijderbare ${removableRoleIds.length === 1 ? "rol" : "rollen"} verwijderd${preservedRoleMentions.length > 0 ? `; ${preservedRoleMentions.join(", ")} behouden` : ""}`;
      } else {
        sanctionText = `${blacklistRoles.map((role) => `<@&${role.id}>`).join(" en ")} worden bij terugkomst automatisch toegekend`;
      }
    }

    const typeLabel = type === "waarschuwing" ? "Waarschuwing" : "Ontslagen";
    const warningEmbed = new EmbedBuilder()
      .setColor(type === "waarschuwing" ? 0xffa500 : 0xed4245)
      .setTitle(`${typeLabel} ❌`)
      .setDescription(
        [
          `> **Naam:** ${target.display}`,
          `> **Huidige rang:** <@&${currentRank.id}>`,
          `> **Reden:** ${reason}`,
          `> **Bron:** ${source}`,
          `> **Sanctie:** ${sanctionText}`,
        ].join("\n"),
      )
      .setFooter({
        text:
          type === "ontslagen"
            ? `${CONFIG.blacklistMarker}:${target.userId} • Uitgevoerd door ${interaction.user.tag}`
            : `Uitgevoerd door ${interaction.user.tag}`,
      })
      .setTimestamp();

    await warningChannel.send({
      embeds: [warningEmbed],
      allowedMentions: { parse: [] },
    });

    if (type === "ontslagen") blacklistUserIds.add(target.userId);

    queueSpreadsheetEvent(type === "waarschuwing" ? "warning" : "terminated", {
      discordId: target.member?.id || target.display.match(/\d{17,20}/)?.[0] || null,
      name: target.member?.displayName || target.display,
      currentRankRoleId: currentRank.id,
      currentRankName: currentRank.name,
      reason,
      source,
      sanctionRoleId: appliedSanctionRoleIds[0] || null,
      sanctionRoleIds: appliedSanctionRoleIds,
      sanctionName: appliedSanctionNames.join(", ") || sanctionText,
      actorId: interaction.user.id,
      actorName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      occurredAt: new Date().toISOString(),
    });

    await interaction.editReply(
      `✅ ${typeLabel} voor ${target.display} is verwerkt en geplaatst in <#${CONFIG.warningChannelId}>.`,
    );
  } catch (error) {
    await interaction.editReply(`❌ ${error.message}`);
  }
}

async function handleWarningRemoveCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== warningRemoveCommand.name
  ) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.inGuild()) {
      throw new Error("Deze command werkt alleen in de Discord-server.");
    }

    const executor =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id));

    if (!executor.roles.cache.has(CONFIG.absenceCommandRoleId)) {
      throw new Error(
        `Alleen leden met <@&${CONFIG.absenceCommandRoleId}> mogen deze command gebruiken.`,
      );
    }

    const user = interaction.options.getUser("persoon", true);
    const targetMember =
      interaction.guild.members.cache.get(user.id) ??
      (await interaction.guild.members.fetch(user.id));
    const sanctionRole = interaction.options.getRole("sanctie", true);
    const reason = cleanEmbedValue(
      interaction.options.getString("reden", true),
    );
    const botMember = interaction.guild.members.me;

    if (!botMember) {
      throw new Error("De eigen botrol kon niet worden gevonden.");
    }

    if (
      sanctionRole.id === interaction.guild.id ||
      sanctionRole.managed ||
      sanctionRole.position >= botMember.roles.highest.position
    ) {
      throw new Error(
        "De sanctierol moet een normale rol onder de hoogste botrol zijn.",
      );
    }

    if (!targetMember.roles.cache.has(sanctionRole.id)) {
      throw new Error(
        `<@${targetMember.id}> heeft de sanctierol <@&${sanctionRole.id}> niet.`,
      );
    }

    const warningChannel = await client.channels.fetch(CONFIG.warningChannelId);

    if (!warningChannel?.isTextBased() || !warningChannel.messages) {
      throw new Error("Het waarschuwingenkanaal is geen tekstkanaal.");
    }

    if (warningChannel.guildId !== interaction.guildId) {
      throw new Error("Het waarschuwingenkanaal staat niet in deze server.");
    }

    await targetMember.roles.remove(
      sanctionRole,
      `Waarschuwing ingetrokken door ${interaction.user.tag}: ${reason}`,
    );

    try {
      const spreadsheetResult = await sendSpreadsheetEvent("warning_removed", {
        discordId: targetMember.id,
        name: targetMember.displayName,
        sanctionRoleId: sanctionRole.id,
        sanctionName: sanctionRole.name,
        reason,
        actorId: interaction.user.id,
        actorName:
          interaction.member?.displayName ||
          interaction.user.globalName ||
          interaction.user.username,
        occurredAt: new Date().toISOString(),
      });

      if (!spreadsheetResult) {
        throw new Error(
          "SHEET_WEBHOOK_URL of SHEET_WEBHOOK_SECRET ontbreekt bij de hosting.",
        );
      }
    } catch (error) {
      await targetMember.roles
        .add(
          sanctionRole,
          "Sanctierol hersteld omdat de spreadsheet niet kon worden bijgewerkt.",
        )
        .catch(() => undefined);
      throw new Error(
        `Spreadsheet kon niet worden bijgewerkt. De sanctierol is hersteld. ${error.message}`,
      );
    }

    const removalEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("Waarschuwing ingetrokken ✅")
      .setDescription(
        [
          `> **Naam:** <@${targetMember.id}>`,
          `> **Verwijderde sanctie:** <@&${sanctionRole.id}>`,
          `> **Reden:** ${reason}`,
          `> **Ingetrokken door:** <@${interaction.user.id}>`,
        ].join("\n"),
      )
      .setTimestamp();

    await warningChannel.send({
      embeds: [removalEmbed],
      allowedMentions: { parse: [] },
    });

    await interaction.editReply(
      `✅ De waarschuwing van <@${targetMember.id}> is ingetrokken, <@&${sanctionRole.id}> is verwijderd en de spreadsheet is bijgewerkt.`,
    );
  } catch (error) {
    await interaction.editReply(`❌ ${error.message}`);
  }
}

async function handleBanCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== banCommand.name
  ) {
    return;
  }

  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)
  ) {
    await interaction.reply({
      content: `❌ <@${interaction.user.id}>, you can't use that.`,
      ephemeral: true,
      allowedMentions: { users: [interaction.user.id] },
    });
    return;
  }

  await interaction.deferReply();

  try {
    const userId = interaction.options.getString("userid", true).trim();
    const reason = cleanEmbedValue(
      interaction.options.getString("reden", true),
      450,
    );

    if (!/^\d{17,20}$/.test(userId)) {
      throw new Error("Vul een geldige Discord-gebruikers-ID in.");
    }

    if (userId === interaction.user.id) {
      throw new Error("Je kunt jezelf niet verbannen.");
    }

    if (userId === client.user.id) {
      throw new Error("Je kunt de bot niet verbannen.");
    }

    if (userId === interaction.guild.ownerId) {
      throw new Error("De servereigenaar kan niet worden verbannen.");
    }

    const executor =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id));
    const botMember = interaction.guild.members.me;
    const targetMember =
      interaction.guild.members.cache.get(userId) ??
      (await interaction.guild.members.fetch(userId).catch(() => null));
    const targetUser = await client.users.fetch(userId).catch(() => null);

    if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
      throw new Error("De bot mist de machtiging `Leden verbannen`.");
    }

    if (targetMember) {
      if (
        interaction.user.id !== interaction.guild.ownerId &&
        targetMember.roles.highest.position >= executor.roles.highest.position
      ) {
        throw new Error(
          "Je kunt geen lid met een gelijke of hogere rol verbannen.",
        );
      }

      if (!targetMember.bannable) {
        throw new Error(
          "De bot kan dit lid niet verbannen. Zet de botrol hoger dan de rollen van dit lid.",
        );
      }
    }

    const existingBan = await interaction.guild.bans
      .fetch(userId)
      .catch(() => null);

    if (existingBan) {
      throw new Error("Deze gebruiker is al verbannen.");
    }

    const auditReason =
      `Ban door ${interaction.user.tag} (${interaction.user.id}): ${reason}`.slice(
        0,
        512,
      );

    await interaction.guild.members.ban(userId, { reason: auditReason });

    const userText = targetUser
      ? `${targetUser.tag} (\`${userId}\`)`
      : `\`${userId}\``;
    const banEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🔨 Gebruiker verbannen")
      .setDescription(
        [
          `> **Gebruiker:** ${userText}`,
          `> **Reden:** ${reason}`,
          `> **Verbannen door:** <@${interaction.user.id}>`,
        ].join("\n"),
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [banEmbed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await interaction.editReply(`❌ Ban mislukt: ${error.message}`);
  }
}

async function handleUnbanCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== unbanCommand.name
  ) {
    return;
  }

  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)
  ) {
    await interaction.reply({
      content: `❌ <@${interaction.user.id}>, you can't use that.`,
      ephemeral: true,
      allowedMentions: { users: [interaction.user.id] },
    });
    return;
  }

  await interaction.deferReply();

  try {
    const userId = interaction.options.getString("userid", true).trim();

    if (!/^\d{17,20}$/.test(userId)) {
      throw new Error("Vul een geldige Discord-gebruikers-ID in.");
    }

    const botMember = interaction.guild.members.me;

    if (!botMember?.permissions.has(PermissionFlagsBits.BanMembers)) {
      throw new Error("De bot mist de machtiging `Leden verbannen`.");
    }

    const existingBan = await interaction.guild.bans
      .fetch(userId)
      .catch(() => null);

    if (!existingBan) {
      throw new Error("Deze gebruiker staat niet op de banlijst.");
    }

    const auditReason =
      `Unban door ${interaction.user.tag} (${interaction.user.id})`.slice(0, 512);

    await interaction.guild.members.unban(userId, auditReason);

    const user = existingBan.user;
    const userText = user ? `${user.tag} (\`${userId}\`)` : `\`${userId}\``;
    const unbanEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("🔓 Gebruiker Geunbanned")
      .setDescription(
        [
          `> **Gebruiker:** ${userText}`,
          `> **Geunbanned door:** <@${interaction.user.id}>`,
        ].join("\n"),
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [unbanEmbed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await interaction.editReply(`❌ Unban mislukt: ${error.message}`);
  }
}

async function handleDashboardRefreshCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    ![
      refreshInactivityCommand.name,
      refreshActivityCommand.name,
    ].includes(interaction.commandName)
  ) {
    return;
  }

  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: `❌ <@${interaction.user.id}>, you can't use that.`,
      ephemeral: true,
      allowedMentions: { users: [interaction.user.id] },
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const isInactivity =
    interaction.commandName === refreshInactivityCommand.name;
  const scope = isInactivity ? "inactivity" : "attendance";
  const overviewName = isInactivity
    ? "inactiviteitsoverzicht"
    : "activiteitsoverzicht";
  const result = await refreshDashboard(scope);

  if (result.busy) {
    await interaction.editReply(
      `⏳ Het ${overviewName} wordt al bijgewerkt. Probeer het over enkele seconden opnieuw.`,
    );
    return;
  }

  if (!result.ok) {
    await interaction.editReply(
      `❌ Het ${overviewName} kon niet worden bijgewerkt: ${result.error?.message || "onbekende fout"}`,
    );
    return;
  }

  await interaction.editReply(
    `✅ Het live ${overviewName} is opnieuw bijgewerkt. Er is niets gereset.`,
  );
}

async function handleDashboardResetCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    ![
      resetInactivityCommand.name,
      resetActivityCommand.name,
    ].includes(interaction.commandName)
  ) {
    return;
  }

  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply({
      content: `❌ <@${interaction.user.id}>, you can't use that.`,
      ephemeral: true,
      allowedMentions: { users: [interaction.user.id] },
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  if (refreshInProgress) {
    await interaction.editReply(
      "⏳ De live overzichten worden al bijgewerkt. Probeer de reset over enkele seconden opnieuw.",
    );
    return;
  }

  const isInactivity =
    interaction.commandName === resetInactivityCommand.name;
  const scope = isInactivity ? "inactivity" : "attendance";
  const marker = isInactivity
    ? CONFIG.inactivityDashboardMarker
    : CONFIG.attendanceDashboardMarker;
  const overviewName = isInactivity
    ? "inactiviteitsoverzicht"
    : "activiteitsoverzicht";
  const hadPreviousReset = dashboardResetTimestamps.has(marker);
  const previousResetAt = dashboardResetTimestamps.get(marker);
  const resetAt = Date.now();

  dashboardResetTimestamps.set(marker, resetAt);
  const result = await refreshDashboard(scope);

  if (!result.ok) {
    if (hadPreviousReset) {
      dashboardResetTimestamps.set(marker, previousResetAt);
    } else {
      dashboardResetTimestamps.delete(marker);
    }

    const errorText = result.busy
      ? "de overzichten worden al bijgewerkt"
      : result.error?.message || "onbekende fout";
    await interaction.editReply(
      `❌ Het ${overviewName} kon niet worden gereset: ${errorText}.`,
    );
    return;
  }

  await interaction.editReply(
    `✅ Het live ${overviewName} is gereset. Alle leden beginnen vanaf nu opnieuw; bestaande Discord-berichten zijn bewaard.`,
  );
}

async function getTrackedTargetMember(interaction) {
  const user = interaction.options.getUser("persoon", true);
  const member =
    interaction.guild.members.cache.get(user.id) ??
    (await interaction.guild.members.fetch(user.id));

  if (
    user.bot ||
    CONFIG.excludedUserIds.includes(user.id) ||
    !CONFIG.rankRoleIds.some((roleId) => member.roles.cache.has(roleId))
  ) {
    throw new Error("Deze persoon staat niet in de gekoppelde rollenlijst.");
  }

  return member;
}

async function handleAbsenceCommand(interaction) {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== absenceCommand.name
  ) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (!interaction.inGuild()) {
      throw new Error("Deze command werkt alleen in de Discord-server.");
    }

    const executor =
      interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id));

    if (!executor.roles.cache.has(CONFIG.absenceCommandRoleId)) {
      throw new Error(
        `Alleen leden met <@&${CONFIG.absenceCommandRoleId}> mogen deze command gebruiken.`,
      );
    }

    const targetMember = await getTrackedTargetMember(interaction);
    const absenceChannel = await client.channels.fetch(CONFIG.absenceChannelId);

    if (!absenceChannel?.isTextBased() || !absenceChannel.messages) {
      throw new Error("Het afwezigheidskanaal is geen tekstkanaal.");
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "toevoegen") {
      const start = parseCommandDateTime(
        interaction.options.getString("begin", true),
      );
      const end = parseCommandDateTime(
        interaction.options.getString("einde", true),
      );

      if (!start || !end) {
        throw new Error(
          "Gebruik voor begin en einde het formaat `DD-MM-JJJJ UU:MM`.",
        );
      }

      if (end <= start) {
        throw new Error("De einddatum en -tijd moeten na het begin liggen.");
      }

      const reason =
        interaction.options.getString("reden")?.trim() ||
        "Geen reden opgegeven";
      const formEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("| Afmeldingsformulier")
        .setDescription(
          [
            `> **Naam:** <@${targetMember.id}>`,
            `> **Reden:** ${reason.slice(0, 500)}`,
            `> **Begin datum:** ${formatLocalDate(start)}`,
            `> **Begin tijd:** ${formatLocalTime(start)}`,
            `> **Eind datum:** ${formatLocalDate(end)}`,
            `> **Eind tijd:** ${formatLocalTime(end)}`,
            `> **Tag:** <@${interaction.user.id}>`,
          ].join("\n"),
        )
        .setFooter({
          text: `${CONFIG.manualAbsenceMarker}:${targetMember.id}`,
        })
        .setTimestamp();

      await absenceChannel.send({
        embeds: [formEmbed],
        allowedMentions: { parse: [] },
      });
      await refreshDashboard();
      await interaction.editReply(
        `De afwezigheid van <@${targetMember.id}> is toegevoegd van <t:${Math.floor(start.getTime() / 1_000)}:f> tot <t:${Math.floor(end.getTime() / 1_000)}:f>.`,
      );
      return;
    }

    const monthStart = getMonthStart();
    const scanStart = new Date(monthStart);
    scanStart.setMonth(scanStart.getMonth() - 1);
    const sourceMessages = await fetchMessagesSince(
      absenceChannel,
      scanStart.getTime(),
    );
    const records = getVisibleAbsenceRecords(
      collectAbsenceRecords(
        sourceMessages,
        new Set([targetMember.id]),
        monthStart,
      ).get(targetMember.id),
    );

    if (!records?.length) {
      throw new Error(
        `Er staat geen afwezigheid van <@${targetMember.id}> in de live lijst.`,
      );
    }

    const removalEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setDescription(
        `✅ <@${targetMember.id}> is handmatig uit de afwezigheidslijst gehaald door <@${interaction.user.id}>.`,
      )
      .setFooter({
        text: `${CONFIG.removedAbsenceMarker}:${targetMember.id}`,
      })
      .setTimestamp();

    await absenceChannel.send({
      embeds: [removalEmbed],
      allowedMentions: { parse: [] },
    });
    await refreshDashboard();
    await interaction.editReply(
      `<@${targetMember.id}> is uit de live afwezigheidslijst gehaald.`,
    );
  } catch (error) {
    await interaction.editReply(`❌ ${error.message}`);
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === absenceCommand.name) {
    void handleAbsenceCommand(interaction);
  } else if (interaction.commandName === warningCommand.name) {
    void handleWarningCommand(interaction);
  } else if (interaction.commandName === warningRemoveCommand.name) {
    void handleWarningRemoveCommand(interaction);
  } else if (interaction.commandName === banCommand.name) {
    void handleBanCommand(interaction);
  } else if (interaction.commandName === unbanCommand.name) {
    void handleUnbanCommand(interaction);
  } else if (
    interaction.commandName === refreshInactivityCommand.name ||
    interaction.commandName === refreshActivityCommand.name
  ) {
    void handleDashboardRefreshCommand(interaction);
  } else if (
    interaction.commandName === resetInactivityCommand.name ||
    interaction.commandName === resetActivityCommand.name
  ) {
    void handleDashboardResetCommand(interaction);
  } else if (interaction.commandName === sheetTestCommand.name) {
    void handleSheetTestCommand(interaction);
  }
});

client.on(Events.MessageCreate, (message) => {
  if (
    message.channelId === CONFIG.attendanceChannelId ||
    message.channelId === CONFIG.absenceChannelId
  ) {
    void refreshDashboard();
  }

  if (message.channelId === CONFIG.acceptedChannelId) {
    void processAcceptedMessage(message).catch((error) => {
      console.error("Aangenomen-bericht kon niet worden verwerkt:", error);
    });
  }
});

client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
  if (
    newMessage.channelId === CONFIG.attendanceChannelId ||
    newMessage.channelId === CONFIG.absenceChannelId
  ) {
    void refreshDashboard();
  }

  if (newMessage.channelId === CONFIG.acceptedChannelId) {
    void processAcceptedMessage(newMessage).catch((error) => {
      console.error("Bewerkt aangenomen-bericht kon niet worden verwerkt:", error);
    });
  }
});

client.on(Events.MessageDelete, (message) => {
  if (
    message.channelId === CONFIG.attendanceChannelId ||
    message.channelId === CONFIG.absenceChannelId
  ) {
    void refreshDashboard();
  }
});

client.on(Events.GuildMemberAdd, (member) => {
  if (member.guild.id !== dashboardGuildId) return;

  void refreshDashboard();

  void restoreBlacklistRoles(member).catch((error) => {
    console.error(
      `Blacklistrollen konden na rejoin niet worden hersteld voor ${member.id}:`,
      error,
    );
  });
});

client.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id === dashboardGuildId) void refreshDashboard();

  queueSpreadsheetEvent("departed", {
    ...getRoleSnapshot(member),
    actorId: null,
    actorName: "Server verlaten",
    occurredAt: new Date().toISOString(),
  });
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild.id === dashboardGuildId) void refreshDashboard();

  const addedRoleIds = newMember.roles.cache
    .filter((role) => !oldMember.roles.cache.has(role.id))
    .map((role) => role.id);
  const removedRoleIds = oldMember.roles.cache
    .filter((role) => !newMember.roles.cache.has(role.id))
    .map((role) => role.id);

  if (addedRoleIds.length > 0 || removedRoleIds.length > 0) {
    console.log(
      `Rolwijziging ${newMember.id}: toegevoegd [${addedRoleIds.join(", ") || "geen"}], verwijderd [${removedRoleIds.join(", ") || "geen"}].`,
    );
  }

  const oldRank = getRoleSnapshot(oldMember);
  const newRank = getRoleSnapshot(newMember);

  if (oldRank.rankRoleId === newRank.rankRoleId) {
    if (addedRoleIds.length > 0 || removedRoleIds.length > 0) {
      console.log(
        `Geen gekoppelde rangwissel voor ${newMember.id}; actieve rang blijft ${newRank.rankRoleId || "geen"}.`,
      );
    }
    return;
  }

  console.log(
    `Gekoppelde rangwissel ${newMember.id}: ${oldRank.rankName || "geen"} -> ${newRank.rankName || "geen"}.`,
  );

  const executor = await getRecentRoleChangeExecutor(
    newMember.guild,
    newMember.id,
  );

  queueSpreadsheetEvent(newRank.rankRoleId ? "rank_changed" : "departed", {
    discordId: newMember.id,
    name: newMember.displayName,
    oldRankRoleId: oldRank.rankRoleId,
    oldRankName: oldRank.rankName,
    newRankRoleId: newRank.rankRoleId,
    newRankName: newRank.rankName,
    actorId: executor?.id || null,
    actorName: executor?.name || "Onbekend",
    occurredAt: new Date().toISOString(),
  });
});

client.on(Events.Error, (error) => {
  console.error("Discord-clientfout:", error);
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot is online als ${readyClient.user.tag}.`);

  try {
    await readyClient.user.setAvatar(path.join(__dirname, "bot-avatar.png"));
    console.log("De standaard profielfoto is ingesteld.");
  } catch (error) {
    console.error("De profielfoto kon niet worden ingesteld:", error);
  }

  let dashboardGuild;

  try {
    const attendanceChannel = await client.channels.fetch(
      CONFIG.attendanceChannelId,
    );

    if (!attendanceChannel?.guild) {
      throw new Error("De Discord-server kon niet worden gevonden.");
    }

    dashboardGuild = attendanceChannel.guild;
    dashboardGuildId = dashboardGuild.id;
    await loadAllGuildMembers(dashboardGuild);
  } catch (error) {
    console.error("De ledenlijst kon niet worden geladen:", error);
  }

  try {
    if (!dashboardGuild) {
      throw new Error("De Discord-server kon niet worden gevonden.");
    }

    await registerCommands(dashboardGuild);
  } catch (error) {
    console.error("De slash-commands konden niet worden geregistreerd:", error);
  }

  try {
    if (!dashboardGuild) {
      throw new Error("De Discord-server kon niet worden gevonden.");
    }

    await restoreBlacklistRolesForGuild(dashboardGuild);
  } catch (error) {
    console.error("De blacklistrollen konden niet worden hersteld:", error);
  }

  try {
    const spreadsheet = await sendSpreadsheetEvent("ping", {
      actorId: readyClient.user.id,
      actorName: readyClient.user.username,
      source: "startup",
    });

    if (spreadsheet) {
      console.log(
        `Spreadsheet verbonden: ${spreadsheet.sheetName}.`,
      );
    }
  } catch (error) {
    console.error("Spreadsheetverbindingstest bij opstarten mislukt:", error);
  }

  await refreshDashboard();
  scheduleDashboardUpdates();
});

function startBot() {
  const token = process.env.DISCORD_TOKEN;

  if (!token) throw new Error("DISCORD_TOKEN ontbreekt.");

  return client.login(token);
}

if (require.main === module) void startBot();

module.exports = {
  collectAttendance,
  collectAbsenceRecords,
  collectLatestActivity,
  getBlacklistedUserId,
  getMissedDays,
  getMemberRankId,
  getMentionedUserIds,
  getInactivityDayCounts,
  getMonthStart,
  getMostRecentCompletedWeek,
  getRemovableRoleIds,
  getCanonicalStaffRankName,
  getVisibleAbsenceRecords,
  getWeekPeriod,
  isWeeklyArchiveTime,
  loadAllGuildMembers,
  parseAbsenceForm,
  parseAcceptedMemberMessage,
  parseAcceptedMemberMessages,
  parseCommandDateTime,
};
