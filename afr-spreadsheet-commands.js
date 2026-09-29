const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');

const RANKS = [
  'Junior Event Team', 'Event Team', 'Senior Event Team',
  'Junior Event Host', 'Event Host', 'Senior Event Host',
  'Proef Leiding', 'Assistent Leiding', 'Leiding',
  'Assistent Hoofd Leiding', 'Hoofd Leiding', 'Event Leider',
];

const ACCEPTED_BY = [
  '[AFR] Robin', '[AFR] Alex', '[AFR] Frank B',
  '[AFR] Buze', '[AFR] Jordy D.', '[AFR] Mark',
];

const choices = values => values.map(value => ({ name: value, value }));

const afrSpreadsheetCommands = [
  new SlashCommandBuilder()
    .setName('aangenomen')
    .setDescription('Neem iemand aan en vul de volledige AFR-spreadsheetregel in')
    .addUserOption(o => o.setName('lid').setDescription('Het nieuwe teamlid').setRequired(true))
    .addStringOption(o => o.setName('naam').setDescription('Naam voor in de spreadsheet').setRequired(true))
    .addStringOption(o => o.setName('rang').setDescription('Start-rang').setRequired(true).addChoices(...choices(RANKS)))
    .addStringOption(o => o.setName('aangenomen_door').setDescription('Wie heeft dit lid aangenomen?').setRequired(true).addChoices(...choices(ACCEPTED_BY)))
    .addStringOption(o => o.setName('status').setDescription('Huidige status').addChoices(...choices(['Actief', 'Inactief'])))
    .addStringOption(o => o.setName('aangenomen_op').setDescription('Datum DD-MM-JJJJ; leeg is vandaag'))
    .addStringOption(o => o.setName('waarschuwingen').setDescription('Waarschuwingsstatus').addChoices(...choices(['Geen', 'Waarschuwing 1', 'Waarschuwing 2'])))
    .addBooleanOption(o => o.setName('sollicitatie_behandelaar').setDescription('Is dit lid sollicitatiebehandelaar?'))
    .addBooleanOption(o => o.setName('afwezig').setDescription('Is dit lid afwezig?')),

  new SlashCommandBuilder()
    .setName('promoveren')
    .setDescription('Promoveer iemand en verplaats alle spreadsheetgegevens')
    .addUserOption(o => o.setName('lid').setDescription('Het teamlid').setRequired(true))
    .addStringOption(o => o.setName('nieuwe_rang').setDescription('Nieuwe rang').setRequired(true).addChoices(...choices(RANKS))),

  new SlashCommandBuilder()
    .setName('waarschuwing')
    .setDescription('Pas de waarschuwing in de AFR-spreadsheet aan')
    .addUserOption(o => o.setName('lid').setDescription('Het teamlid').setRequired(true))
    .addStringOption(o => o.setName('niveau').setDescription('Nieuwe waarschuwing').setRequired(true).addChoices(...choices(['Geen', 'Waarschuwing 1', 'Waarschuwing 2']))),

  new SlashCommandBuilder()
    .setName('afwezigheid')
    .setDescription('Zet Afwezig automatisch op Ja of Nee')
    .addUserOption(o => o.setName('lid').setDescription('Het teamlid').setRequired(true))
    .addBooleanOption(o => o.setName('afwezig').setDescription('Ja = afwezig, Nee = aanwezig').setRequired(true)),

  new SlashCommandBuilder()
    .setName('teamstatus')
    .setDescription('Zet een teamlid op Actief of Inactief')
    .addUserOption(o => o.setName('lid').setDescription('Het teamlid').setRequired(true))
    .addStringOption(o => o.setName('status').setDescription('Nieuwe status').setRequired(true).addChoices(...choices(['Actief', 'Inactief']))),

  new SlashCommandBuilder()
    .setName('ontslag')
    .setDescription('Verwijder iemand uit de AFR-spreadsheet en maak de plek vrij')
    .addUserOption(o => o.setName('lid').setDescription('Het teamlid').setRequired(true)),

  new SlashCommandBuilder()
    .setName('aangenomeninhalen')
    .setDescription('Plaats voor alle bestaande spreadsheetleden apart een welkomstmelding'),
].map(command => command.setDefaultMemberPermissions(null).setDMPermission(false));

function magSpreadsheetBeheren(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) return true;
  const allowed = String(process.env.AFR_SHEET_MANAGER_ROLE_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean);
  return interaction.member?.roles?.cache?.some(role => allowed.includes(role.id)) || false;
}

function datumVandaag() {
  const parts = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('day')}-${get('month')}-${get('year')}`;
}

function rangKleur(rank) {
  if (rank === 'Event Leider') return 0xFFD700;
  if (rank === 'Hoofd Leiding') return 0xFF1493;
  if (rank === 'Assistent Hoofd Leiding') return 0xFF4FB3;
  if (rank === 'Leiding') return 0x3498DB;
  if (rank === 'Assistent Leiding') return 0x74C0FC;
  if (rank === 'Proef Leiding') return 0xFF8C00;
  if (rank.includes('Event Host')) return 0x238636;
  return 0x57D68D;
}

function maakAangenomenEmbed(member, data, interaction, bestaand = false) {
  const mention = member ? `${member}` : `<@${data.discordId}>`;
  const embed = new EmbedBuilder()
    .setColor(rangKleur(data.rank))
    .setAuthor({
      name: 'AFR Event Team',
      iconURL: interaction.guild?.iconURL({ size: 256 }) || undefined,
    })
    .setTitle(bestaand ? 'ð Event Team-lid!' : 'ð Nieuw Event Team-lid aangenomen!')
    .setDescription(
      `Van harte welkom ${mention} bij het **AFR Event Team**!\n` +
      'We wensen je veel succes en vooral veel plezier binnen het team. ð',
    )
    .addFields(
      { name: 'ð¤ Naam', value: data.name, inline: true },
      { name: 'ð·ï¸ Rang', value: data.rank, inline: true },
      { name: 'ð¢ Status', value: data.status, inline: true },
      { name: 'ð Aangenomen op', value: data.acceptedDate, inline: true },
      { name: 'ð¤ Aangenomen door', value: data.acceptedBy, inline: true },
      { name: 'ð Discord ID', value: data.discordId || member?.id || 'Onbekend', inline: true },
    )
    .setFooter({ text: `AFR Event Team â¢ Welkom ${data.name}!` })
    .setTimestamp();

  if (member) embed.setThumbnail(member.displayAvatarURL({ size: 256 }));
  return embed;
}

async function haalBestaandeAangenomenMeldingenIn(interaction) {
  const result = await stuurNaarSpreadsheet('members', {
    actorId: interaction.user.id,
    actorName: interaction.member?.displayName || interaction.user.username,
  });
  const members = Array.isArray(result?.members) ? result.members : [];
  if (!members.length) throw new Error('Er staan geen ingevulde leden in de spreadsheet.');
  if (!interaction.channel?.isTextBased()) throw new Error('Dit kanaal ondersteunt geen berichten.');

  let geplaatst = 0;
  for (const data of members) {
    const member = await interaction.client.users.fetch(data.discordId).catch(() => null);
    await interaction.channel.send({
      content: `<@${data.discordId}>`,
      embeds: [maakAangenomenEmbed(member, data, interaction, true)],
      allowedMentions: { users: [data.discordId] },
    });
    geplaatst += 1;
    if (geplaatst < members.length) {
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }

  return geplaatst;
}

async function stuurNaarSpreadsheet(type, data) {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error('SHEET_WEBHOOK_URL of SHEET_WEBHOOK_SECRET ontbreekt in Railway.');

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, type, data }),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.ok) return payload.result;

      const message = payload?.error || `Spreadsheetfout (${response.status}).`;
      lastError = new Error(message);
      const tijdelijk = response.status === 404 || response.status === 408 ||
        response.status === 429 || response.status >= 500;
      if (!tijdelijk || attempt === 3) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }

    await new Promise(resolve => setTimeout(resolve, attempt * 1_500));
  }

  throw new Error(`Google Sheets reageerde na 3 pogingen niet goed: ${lastError?.message || lastError}`);
}

async function handleAfrSpreadsheetCommand(interaction) {
  const supported = ['aangenomen', 'aangenomeninhalen', 'promoveren', 'waarschuwing', 'afwezigheid', 'teamstatus', 'ontslag'];
  if (!interaction.isChatInputCommand() || !supported.includes(interaction.commandName)) return false;

  if (!interaction.inGuild() || !magSpreadsheetBeheren(interaction)) {
    await interaction.reply({ content: 'Je hebt geen toegang tot het AFR-spreadsheetbeheer.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (interaction.commandName === 'aangenomeninhalen') {
    try {
      const geplaatst = await haalBestaandeAangenomenMeldingenIn(interaction);
      await interaction.editReply(`â Voor ${geplaatst} bestaande leden is apart een welkomstmelding geplaatst.`);
    } catch (error) {
      console.error('Bestaande aangenomen-meldingen inhalen mislukt:', error);
      await interaction.editReply(`â ${error.message}`);
    }
    return true;
  }

  const member = interaction.options.getUser('lid', true);
  const common = {
    discordId: member.id,
    actorId: interaction.user.id,
    actorName: interaction.member?.displayName || interaction.user.username,
  };

  try {
    let type;
    let data = common;

    if (interaction.commandName === 'aangenomen') {
      type = 'accepted';
      data = {
        ...common,
        name: interaction.options.getString('naam', true),
        rank: interaction.options.getString('rang', true),
        acceptedBy: interaction.options.getString('aangenomen_door', true),
        status: interaction.options.getString('status') || 'Actief',
        acceptedDate: interaction.options.getString('aangenomen_op') || datumVandaag(),
        warnings: interaction.options.getString('waarschuwingen') || 'Geen',
        applicationHandler: interaction.options.getBoolean('sollicitatie_behandelaar') || false,
        absent: interaction.options.getBoolean('afwezig') || false,
      };
    } else if (interaction.commandName === 'promoveren') {
      type = 'promoted';
      data = { ...common, newRank: interaction.options.getString('nieuwe_rang', true) };
    } else if (interaction.commandName === 'waarschuwing') {
      type = 'warning_set';
      data = { ...common, warning: interaction.options.getString('niveau', true) };
    } else if (interaction.commandName === 'afwezigheid') {
      type = 'absence_changed';
      data = { ...common, absent: interaction.options.getBoolean('afwezig', true) };
    } else if (interaction.commandName === 'teamstatus') {
      type = 'status_changed';
      data = { ...common, status: interaction.options.getString('status', true) };
    } else {
      type = 'terminated';
    }

    let result = null;
    let spreadsheetError = null;
    try {
      result = await stuurNaarSpreadsheet(type, data);
    } catch (error) {
      spreadsheetError = error;
      if (interaction.commandName !== 'aangenomen') throw error;
      console.warn('Aangenomen-melding wordt geplaatst ondanks spreadsheetfout:', error);
    }

    if (interaction.commandName === 'aangenomen') {
      try {
        if (!interaction.channel?.isTextBased()) {
          throw new Error('Dit kanaal ondersteunt geen berichten.');
        }
        await interaction.channel.send({
          content: `${member}`,
          embeds: [maakAangenomenEmbed(member, data, interaction)],
          allowedMentions: { users: [member.id] },
        });
        if (spreadsheetError) {
          await interaction.editReply(
            `â De welkomstmelding is in dit kanaal geplaatst.\nâ ï¸ Google Sheets kon na 3 pogingen niet worden bijgewerkt: ${spreadsheetError.message}`,
          );
        } else {
          await interaction.editReply(`â ${result.message}\nâ De welkomstmelding is in dit kanaal geplaatst.`);
        }
      } catch (announcementError) {
        console.warn('Welkomstmelding kon niet worden geplaatst:', announcementError);
        const sheetStatus = spreadsheetError
          ? `â ï¸ Google Sheets is niet bijgewerkt: ${spreadsheetError.message}`
          : `â ${result.message}`;
        await interaction.editReply(`${sheetStatus}\nâ ï¸ De welkomstmelding kon niet worden geplaatst. Controleer mijn berichtrechten.`);
      }
    } else {
      await interaction.editReply(`â ${result.message}`);
    }
  } catch (error) {
    console.error('AFR spreadsheetactie mislukt:', error);
    await interaction.editReply(`â ${error.message}`);
  }
  return true;
}

module.exports = {
  afrSpreadsheetCommands,
  handleAfrSpreadsheetCommand,
};
