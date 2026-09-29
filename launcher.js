const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const indexPath = path.join(__dirname, "index.js");
let source = fs.readFileSync(indexPath, "utf8");

function replaceRequired(search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Opstartpatch ontbreekt: ${label}.`);
  }
  source = source.replace(search, replacement);
}

replaceRequired(
  'signal: AbortSignal.timeout(15_000),',
  'signal: AbortSignal.timeout(60_000),',
  "spreadsheet-time-out",
);

replaceRequired(
  '  const obsoleteCommandNames = new Set([\n    "werkaangenomen",',
  '  const obsoleteCommandNames = new Set([\n    "aannemen",\n    "werkaangenomen",',
  "oude command aannemen verwijderen",
);

replaceRequired(
  `    const attendanceChannel = await client.channels.fetch(
      CONFIG.attendanceChannelId,
    );

    if (!attendanceChannel?.guild) {
      throw new Error("De Discord-server kon niet worden gevonden.");
    }

    dashboardGuild = attendanceChannel.guild;`,
  `    const configuredGuildId =
      process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || "";

    if (configuredGuildId) {
      dashboardGuild =
        readyClient.guilds.cache.get(configuredGuildId) ||
        (await readyClient.guilds.fetch(configuredGuildId).catch(() => null));
    } else if (readyClient.guilds.cache.size === 1) {
      dashboardGuild = readyClient.guilds.cache.first();
    }

    if (!dashboardGuild) {
      throw new Error(
        "De bot zit niet in een Discord-server. Voeg DISCORD_GUILD_ID toe als de bot in meerdere servers staat.",
      );
    }`,
  "Discord-server zonder oud kanaal bepalen",
);

replaceRequired(
  `  } catch (error) {
    console.error("De dashboards konden niet worden bijgewerkt:", error);
    return { ok: false, error };
  } finally {`,
  `  } catch (error) {
    if (!globalThis.__afrDashboardWarningShown) {
      globalThis.__afrDashboardWarningShown = true;
      console.warn(\`Dashboard overgeslagen: \${error.message || error}\`);
    }
    return { ok: false, error };
  } finally {`,
  "ontbrekend dashboardkanaal zonder error-spam",
);

replaceRequired(
  '    console.error("Spreadsheetverbindingstest bij opstarten mislukt:", error);',
  '    console.warn(`Spreadsheetverbindingstest overgeslagen: ${error.message || error}`);',
  "spreadsheet-opstartmelding",
);

replaceRequired(
  "    await restoreBlacklistRolesForGuild(dashboardGuild);",
  `    void restoreBlacklistRolesForGuild(dashboardGuild).catch((error) => {
      console.warn(\`Blacklistcontrole overgeslagen: \${error.message || error}\`);
    });`,
  "blacklistcontrole op de achtergrond",
);

replaceRequired(
  '    const spreadsheet = await sendSpreadsheetEvent("ping", {',
  '    console.log("Spreadsheetkoppeling controleren...");\n    const spreadsheet = await sendSpreadsheetEvent("ping", {',
  "zichtbare spreadsheetcontrole",
);

replaceRequired(
  "    await loadAllGuildMembers(dashboardGuild);",
  `    await loadAllGuildMembers(dashboardGuild);
    console.log("Spreadsheetkoppeling direct controleren...");
    void sendSpreadsheetEvent("ping", {
      actorId: readyClient.user.id,
      actorName: readyClient.user.username,
      source: "startup-direct",
    })
      .then((spreadsheet) => {
        if (spreadsheet) {
          console.log(\`Spreadsheet verbonden: \${spreadsheet.sheetName}.\`);
        }
      })
      .catch((error) => {
        console.warn(\`Spreadsheetkoppeling mislukt: \${error.message || error}\`);
      });`,
  "spreadsheetcontrole vóór commandregistratie",
);

replaceRequired(
  "if (require.main === module) void startBot();",
  "void startBot();",
  "bot daadwerkelijk starten",
);

replaceRequired(
  `  if (message.channelId === CONFIG.absenceChannelId) {
    if (
      !message.author.bot &&
      message.createdTimestamp >= CONFIG.absenceApprovalStartTimestamp
    ) {
      void processAbsenceTemplateMessage(message).catch((error) => {
        console.error(
          \`Afwezigheidstemplate \${message.id} kon niet worden omgezet:\`,
          error,
        );
      });
    } else {
      void refreshDashboard();
    }
  }`,
  `  if (message.channelId === CONFIG.absenceChannelId) {
    void refreshDashboard();
  }`,
  "oude afwezigheidstemplate bij nieuwe berichten uitschakelen",
);

replaceRequired(
  `  if (newMessage.channelId === CONFIG.absenceChannelId) {
    if (
      !newMessage.author?.bot &&
      newMessage.createdTimestamp >= CONFIG.absenceApprovalStartTimestamp
    ) {
      void processAbsenceTemplateMessage(newMessage).catch((error) => {
        console.error(
          \`Bewerkte afwezigheidstemplate \${newMessage.id} kon niet worden omgezet:\`,
          error,
        );
      });
    } else {
      void refreshDashboard();
    }
  }`,
  `  if (newMessage.channelId === CONFIG.absenceChannelId) {
    void refreshDashboard();
  }`,
  "oude afwezigheidstemplate bij bewerkte berichten uitschakelen",
);

replaceRequired(
  `  try {
    if (!dashboardGuild) {
      throw new Error("De Discord-server kon niet worden gevonden.");
    }

    await migrateUnprocessedAbsenceTemplates(dashboardGuild);
  } catch (error) {
    console.error(
      "Openstaande afwezigheidstemplates konden niet worden omgezet:",
      erroq,
    );
  }`,
  `  console.log("Oude afwezigheidstemplate is uitgeschakeld.");`,
  "oude afwezigheidstemplates bij opstarten uitschakelen",
);

const runtimeModule = new Module(indexPath, module);
runtimeModule.filename = indexPath;
runtimeModule.paths = Module._nodeModulePaths(__dirname);
runtimeModule._compile(source, indexPath);
