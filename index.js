const path = require("node:path");
const {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
} = require("discord.js");

process.env.TZ = "Europe/Amsterdam";

const CONFIG = Object.freeze({
  attendanceChannelId: "1438602360095113390",
  overviewChannelId: "1537247199606608013",
  memberRoleId: "1440057853044850780",
  timeZone: "Europe/Amsterdam",
  updateIntervalMs: 5 * 60 * 1000,
  dashboardMarker: "AFR-WEEKOVERZICHT",
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let dashboardMessages;
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

function getMentionedUserIds(content) {
  return new Set(
    [...content.matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]),
  );
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

function buildDashboardEmbeds(members, attendance, period, messageCount) {
  const sortedMembers = [...members].sort((memberA, memberB) => {
    const countDifference =
      attendance.get(memberB.id).size - attendance.get(memberA.id).size;

    return (
      countDifference ||
      memberA.displayName.localeCompare(memberB.displayName, "nl")
    );
  });

  const lines = sortedMembers.map((member) => {
    const dates = attendance.get(member.id);
    const count = dates.size;
    const icon = count >= 5 ? "👑" : count >= 3 ? "🟢" : count === 2 ? "🟠" : "🔴";
    const dateText = count > 0 ? ` · ${formatAttendanceDates(dates)}` : "";

    return `${icon} <@${member.id}> — **${count}/7 dagen**${dateText}`;
  });

  const chunks = chunkLines(lines);
  const presentCount = sortedMembers.filter(
    (member) => attendance.get(member.id).size > 0,
  ).length;
  const updatedAt = Math.floor(Date.now() / 1_000);
  const startAt = Math.floor(period.start.getTime() / 1_000);
  const endAt = Math.floor(period.end.getTime() / 1_000);
  const avatarUrl = client.user.displayAvatarURL({ size: 256 });

  return chunks.map((chunk, index) => {
    const isFirstPage = index === 0;
    const summary = isFirstPage
      ? [
          `Alle leden met <@&${CONFIG.memberRoleId}> staan hieronder. Iedere persoon telt maximaal één keer per dag.`,
          "",
          `**Aanwezig deze week:** ${presentCount}/${sortedMembers.length}`,
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

    return new EmbedBuilder()
      .setColor(0xd7ff00)
      .setAuthor({ name: "Event Team", iconURL: avatarUrl })
      .setTitle(
        chunks.length === 1
          ? "📋 Wekelijks aanwezigheidsoverzicht"
          : `📋 Wekelijks aanwezigheidsoverzicht (${index + 1}/${chunks.length})`,
      )
      .setDescription([...summary, ...chunk].join("\n"))
      .setThumbnail(avatarUrl)
      .setFooter({
        text: `${CONFIG.dashboardMarker} • ${messageCount} berichten verwerkt • iedere 5 minuten live bijgewerkt`,
      })
      .setTimestamp(updatedAt * 1_000);
  });
}

async function findDashboardMessages(channel) {
  const recentMessages = await channel.messages.fetch({ limit: 100 });

  return [...recentMessages.values()]
    .filter(
      (message) =>
        message.author.id === client.user.id &&
        message.embeds.some((embed) =>
          embed.footer?.text?.startsWith(CONFIG.dashboardMarker),
        ),
    )
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function publishDashboard(channel, embeds) {
  if (!dashboardMessages) {
    dashboardMessages = await findDashboardMessages(channel);
  }

  const publishedMessages = [];

  for (let index = 0; index < embeds.length; index += 1) {
    const payload = {
      embeds: [embeds[index]],
      allowedMentions: { parse: [] },
    };

    if (dashboardMessages[index]) {
      publishedMessages.push(await dashboardMessages[index].edit(payload));
    } else {
      publishedMessages.push(await channel.send(payload));
    }
  }

  for (const extraMessage of dashboardMessages.slice(embeds.length)) {
    await extraMessage.delete().catch(() => undefined);
  }

  dashboardMessages = publishedMessages;
}

async function refreshDashboard() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  try {
    const [attendanceChannel, overviewChannel] = await Promise.all([
      client.channels.fetch(CONFIG.attendanceChannelId),
      client.channels.fetch(CONFIG.overviewChannelId),
    ]);

    if (!attendanceChannel?.isTextBased() || !attendanceChannel.messages) {
      throw new Error("Het aanwezigheidskanaal is geen tekstkanaal.");
    }

    if (!overviewChannel?.isTextBased() || !overviewChannel.messages) {
      throw new Error("Het overzichtskanaal is geen tekstkanaal.");
    }

    const guild = attendanceChannel.guild;

    if (!guild || overviewChannel.guildId !== guild.id) {
      throw new Error("De kanalen moeten in dezelfde Discord-server staan.");
    }

    await guild.members.fetch();

    const members = guild.members.cache.filter(
      (member) =>
        !member.user.bot && member.roles.cache.has(CONFIG.memberRoleId),
    );
    const period = getWeekPeriod();
    const messages = await fetchMessagesSince(
      attendanceChannel,
      period.start.getTime(),
    );
    const attendance = collectAttendance(messages, new Set(members.keys()));
    const embeds = buildDashboardEmbeds(
      members.values(),
      attendance,
      period,
      messages.length,
    );

    await publishDashboard(overviewChannel, embeds);
    console.log(
      `Aanwezigheid bijgewerkt: ${members.size} leden, ${messages.length} berichten.`,
    );
  } catch (error) {
    console.error("Het aanwezigheidsoverzicht kon niet worden bijgewerkt:", error);
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

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot is online als ${readyClient.user.tag}.`);

  try {
    await readyClient.user.setAvatar(path.join(__dirname, "bot-avatar.png"));
    console.log("De standaard profielfoto is ingesteld.");
  } catch (error) {
    console.error("De profielfoto kon niet worden ingesteld:", error);
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
  getMentionedUserIds,
  getWeekPeriod,
};
