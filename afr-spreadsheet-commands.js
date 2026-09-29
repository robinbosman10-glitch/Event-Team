const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
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
    .setName('aannemen')
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
].map(command => command.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles).setDMPermission(false));

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

async function stuurNaarSpreadsheet(type, data) {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error('SHEET_WEBHOOK_URL of SHEET_WEBHOOK_SECRET ontbreekt in Railway.');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret, type, data }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Spreadsheetfout (${response.status}).`);
  return payload.result;
}

async function handleAfrSpreadsheetCommand(interaction) {
  const supported = ['aannemen', 'promoveren', 'waarschuwing', 'afwezigheid', 'teamstatus', 'ontslag'];
  if (!interaction.isChatInputCommand() || !supported.includes(interaction.commandName)) return false;

  if (!interaction.inGuild() || !magSpreadsheetBeheren(interaction)) {
    await interaction.reply({ content: 'Je hebt geen toegang tot het AFR-spreadsheetbeheer.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = interaction.options.getUser('lid', true);
  const common = {
    discordId: member.id,
    actorId: interaction.user.id,
    actorName: interaction.member?.displayName || interaction.user.username,
  };

  try {
    let type;
    let data = common;

    if (interaction.commandName === 'aannemen') {
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

    const result = await stuurNaarSpreadsheet(type, data);
    await interaction.editReply(`✅ ${result.message}`);
  } catch (error) {
    console.error('AFR spreadsheetactie mislukt:', error);
    await interaction.editReply(`❌ ${error.message}`);
  }
  return true;
}

module.exports = {
  afrSpreadsheetCommands,
  handleAfrSpreadsheetCommand,
};
