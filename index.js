const path = require("node:path");
const {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} = require("discord.js");

process.env.TZ = "Europe/Amsterdam";

const CONFIG = Object.freeze({
  attendanceChannelId: "1438602360095113390",
  overviewChannelId: "1537247199606608013",
  inactivityChannelId: "1537255726735691786",
  absenceChannelId: "1509628813628280842",
  absenceCommandRoleId: "1218521637368893471",
  excludedUserIds: ["683032015045787676"],
  attendanceExemptRoleIds: [
    "1218521637368893471",
    "1518661886579707974",
    "1438207385587028119",
  ],
  rankRoleIds: [
    "1218521637368893471",
    "1518661886579707974",
    "1438207385587028119",
    "1492244526356758748",
    "1469669109988987006",
    "1503083088148697320",
    "1437915250182848653",
    "1453080104019427441",
    "1503084773508124843",
    "1218521533606137926",
    "1440057853044850780",
  ],
  timeZone: "Europe/Amsterdam",
  inactivityCutoffHour: 21,
  updateIntervalMs: 5 * 60 * 1000,
  attendanceDashboardMarker: "AFR-WEEKOVERZICHT",
  inactivityDashboardMarker: "AFR-INACTIVITEIT",
  manualAbsenceMarker: "AFR-HANDMATIG-AFWEZIG",
  removedAbsenceMarker: "AFR-AFWEZIG-VERWIJDERD",
});

const absenceCommand = new SlashCommandBuilder()
  .setName("afwezig")
  .setDescription("Beheer handmatige afwezigheden.")
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const dashboardMessagesByMarker = new Map();
let refreshInProgress = false;

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

function getMissedDays(lastActivityTimestamp, trackingStart, now = new Date()) {
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
  let cutoff = firstCutoff;

  while (cutoff <= current) {
    missedDays += 1;
    cutoff = addLocalDays(cutoff, 1);
  }

  return missedDays;
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
    const dateKey = [
      messageDate.getFullYear(),
      String(messageDate.getMonth() + 1).padStart(2, "0"),
      String(messageDate.getDate()).padStart(2, "0"),
    ].join("-");

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
  const updatedAt = Math.floor(Date.now() / 1_000);
  const startAt = Math.floor(period.start.getTime() / 1_000);
  const endAt = Math.floor(period.end.getTime() / 1_000);
  const avatarUrl = client.user.displayAvatarURL({ size: 256 });

  return chunks.map((chunk, index) => {
    const isFirstPage = index === 0;
    const isLastPage = index === chunks.length - 1;
    const summary = isFirstPage
      ? [
          "Alle Event Team-leden staan hieronder op rang gesorteerd. Iemand met meerdere rangen staat alleen onder de hoogste rang. Iedere persoon telt maximaal één keer per dag.",
          "",
          `**Aanwezig deze week:** ${presentCount}/${attendanceRequiredMembers.length}`,
          `**Geen aanwezigheid nodig:** ${exemptCount} leden`,
          `**Periode:** <t:${startAt}:f> tot <t:${endAt}:f>`,
          `**Automatische reset:** <t:${endAt}:R>`,
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
        .setTitle("📋 Wekelijks aanwezigheidsoverzicht")
        .setThumbnail(avatarUrl);
    }

    if (isLastPage) {
      embed.setFooter({
        text: `${CONFIG.attendanceDashboardMarker} • ${messageCount} berichten verwerkt • iedere 5 minuten live bijgewerkt`,
      });
      embed.setTimestamp(updatedAt * 1_000);
    }

    return embed;
  });
}

function getMemberInactivity(member, latestActivity, monthStart, now) {
  const lastActivityTimestamp = latestActivity.get(member.id);
  const trackingStart = new Date(
    Math.max(monthStart.getTime(), member.joinedTimestamp || 0),
  );

  return {
    lastActivityTimestamp,
    missedDays: getMissedDays(lastActivityTimestamp, trackingStart, now),
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

function formatInactivityMemberLine(member, inactivity, absences, now) {
  const absenceLines = (absences.get(member.id) || []).map((record) =>
    formatAbsenceRecord(record, now),
  );

  if (CONFIG.attendanceExemptRoleIds.includes(getMemberRankId(member))) {
    return [
      `✨ <@${member.id}> — **Geen Inactiviteit bijhouden!**`,
      ...absenceLines,
    ].join("\n");
  }

  const { lastActivityTimestamp, missedDays } = inactivity.get(member.id);

  if (missedDays >= 2) {
    const lastSeenText = lastActivityTimestamp
      ? ` · laatst meegedaan <t:${Math.floor(lastActivityTimestamp / 1_000)}:R>`
      : " · deze maand nog niet meegedaan";

    return [
      `🔴 <@${member.id}> — **${missedDays} dagen inactief**${lastSeenText}`,
      ...absenceLines,
    ].join("\n");
  }

  const lastSeenText = lastActivityTimestamp
    ? ` · laatst meegedaan <t:${Math.floor(lastActivityTimestamp / 1_000)}:R>`
    : " · deze maand nog niet meegedaan";

  return [
    `🟢 <@${member.id}> — **Actief** · ${missedDays}/2 gemiste dagen${lastSeenText}`,
    ...absenceLines,
  ].join("\n");
}

function buildInactivityDashboardEmbeds(
  members,
  latestActivity,
  absences,
  monthStart,
  messageCount,
  now = new Date(),
) {
  const allMembers = [...members];
  const inactivity = new Map(
    allMembers.map((member) => [
      member.id,
      getMemberInactivity(member, latestActivity, monthStart, now),
    ]),
  );
  const lines = buildRankLines(
    allMembers,
    (member) =>
      formatInactivityMemberLine(member, inactivity, absences, now),
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
  const monthStartAt = Math.floor(monthStart.getTime() / 1_000);
  const avatarUrl = client.user.displayAvatarURL({ size: 256 });

  return chunks.map((chunk, index) => {
    const isFirstPage = index === 0;
    const isLastPage = index === chunks.length - 1;
    const summary = isFirstPage
      ? [
          "Dit overzicht is gekoppeld aan dezelfde aanwezigheidsberichten. Een deelname zet de inactiviteit direct terug naar nul.",
          "",
          `**Inactief:** ${inactiveCount}/${trackedMembers.length}`,
          `**Momenteel afwezig gemeld:** ${reportedAbsentCount} leden`,
          `**Geen inactiviteit bijhouden:** ${exemptCount} leden`,
          `**Meten vanaf:** <t:${monthStartAt}:D>`,
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
        text: `${CONFIG.inactivityDashboardMarker} • ${messageCount} berichten verwerkt • iedere 5 minuten live bijgewerkt`,
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

async function refreshDashboard() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    const [
      attendanceChannel,
      overviewChannel,
      inactivityChannel,
      absenceChannel,
    ] =
      await Promise.all([
        client.channels.fetch(CONFIG.attendanceChannelId),
        client.channels.fetch(CONFIG.overviewChannelId),
        client.channels.fetch(CONFIG.inactivityChannelId),
        client.channels.fetch(CONFIG.absenceChannelId),
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

    const guild = attendanceChannel.guild;

    if (
      !guild ||
      overviewChannel.guildId !== guild.id ||
      inactivityChannel.guildId !== guild.id ||
      absenceChannel.guildId !== guild.id
    ) {
      throw new Error("De kanalen moeten in dezelfde Discord-server staan.");
    }

    await guild.members.fetch();

    const members = guild.members.cache.filter(
      (member) =>
        !member.user.bot &&
        !CONFIG.excludedUserIds.includes(member.id) &&
        CONFIG.rankRoleIds.some((roleId) => member.roles.cache.has(roleId)),
    );
    const now = new Date();
    const period = getWeekPeriod(now);
    const monthStart = getMonthStart(now);
    const absenceScanStart = new Date(monthStart);
    absenceScanStart.setMonth(absenceScanStart.getMonth() - 1);
    const scanStart = Math.min(period.start.getTime(), monthStart.getTime());
    const [messages, absenceMessages] = await Promise.all([
      fetchMessagesSince(attendanceChannel, scanStart),
      fetchMessagesSince(absenceChannel, absenceScanStart.getTime()),
    ]);
    const weeklyMessages = messages.filter(
      (message) =>
        message.createdTimestamp >= period.start.getTime() &&
        message.createdTimestamp < period.end.getTime(),
    );
    const monthlyMessages = messages.filter(
      (message) => message.createdTimestamp >= monthStart.getTime(),
    );
    const memberIds = new Set(members.keys());
    const attendance = collectAttendance(weeklyMessages, memberIds);
    const latestActivity = collectLatestActivity(monthlyMessages, memberIds);
    const absences = collectAbsenceRecords(
      absenceMessages,
      memberIds,
      monthStart,
    );
    const attendanceEmbeds = buildAttendanceDashboardEmbeds(
      members.values(),
      attendance,
      period,
      weeklyMessages.length,
    );
    const inactivityEmbeds = buildInactivityDashboardEmbeds(
      members.values(),
      latestActivity,
      absences,
      monthStart,
      absenceMessages.length,
      now,
    );

    await publishDashboard(
      overviewChannel,
      attendanceEmbeds,
      CONFIG.attendanceDashboardMarker,
    );
    await publishDashboard(
      inactivityChannel,
      inactivityEmbeds,
      CONFIG.inactivityDashboardMarker,
    );
    console.log(
      `Dashboards bijgewerkt: ${members.size} leden, ${monthlyMessages.length} aanwezigheidsberichten en ${absenceMessages.length} afwezigheidsberichten.`,
    );
  } catch (error) {
    console.error("De dashboards konden niet worden bijgewerkt:", error);
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

async function registerAbsenceCommand(guild) {
  const commands = await guild.commands.fetch();
  const existingCommand = commands.find(
    (command) => command.name === absenceCommand.name,
  );
  const commandData = absenceCommand.toJSON();

  if (existingCommand) {
    await existingCommand.edit(commandData);
  } else {
    await guild.commands.create(commandData);
  }

  console.log("Slash-command /afwezig is geregistreerd.");
}

async function getTrackedTargetMember(interaction) {
  const user = interaction.options.getUser("persoon", true);
  const member = await interaction.guild.members.fetch(user.id);

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

    const executor = await interaction.guild.members.fetch(interaction.user.id);

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
    const records = collectAbsenceRecords(
      sourceMessages,
      new Set([targetMember.id]),
      monthStart,
    ).get(targetMember.id);

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
  void handleAbsenceCommand(interaction);
});

client.on(Events.MessageCreate, (message) => {
  if (
    message.channelId === CONFIG.attendanceChannelId ||
    message.channelId === CONFIG.absenceChannelId
  ) {
    void refreshDashboard();
  }
});

client.on(Events.MessageUpdate, (_oldMessage, newMessage) => {
  if (
    newMessage.channelId === CONFIG.attendanceChannelId ||
    newMessage.channelId === CONFIG.absenceChannelId
  ) {
    void refreshDashboard();
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

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot is online als ${readyClient.user.tag}.`);

  try {
    await readyClient.user.setAvatar(path.join(__dirname, "bot-avatar.png"));
    console.log("De standaard profielfoto is ingesteld.");
  } catch (error) {
    console.error("De profielfoto kon niet worden ingesteld:", error);
  }

  try {
    const attendanceChannel = await client.channels.fetch(
      CONFIG.attendanceChannelId,
    );

    if (!attendanceChannel?.guild) {
      throw new Error("De Discord-server kon niet worden gevonden.");
    }

    await registerAbsenceCommand(attendanceChannel.guild);
  } catch (error) {
    console.error("Slash-command /afwezig kon niet worden geregistreerd:", error);
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
  getMissedDays,
  getMemberRankId,
  getMentionedUserIds,
  getMonthStart,
  getWeekPeriod,
  parseAbsenceForm,
  parseCommandDateTime,
};
