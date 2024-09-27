const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stream')
		.setDescription('Summons Stream Bot to stream the game'),
	async execute(interaction) {
		await interaction.deferReply();

		const member = await interaction.guild.members.fetch(interaction.member.id);
		const voiceChannel = member.voice.channel;

		if (!voiceChannel) {
			return interaction.followUp('You need to be in a voice channel to use this command.');
		}

		const streamURL = process.env.STREAM_URL;
		const guildId = interaction.guildId;
		const channelId = voiceChannel.id;

		const requestData = {
			guildId: guildId,
			channelId: channelId,
			streamURL: streamURL,
		};

		try {
			await axios.post(`${process.env.STREAM_BOT_URL}/play`, requestData, {
				headers: {
					'Content-Type': 'application/json',
				},
			});
			await interaction.followUp(`Started streaming in ${voiceChannel.name}`);
		} catch (error) {
			console.error(error);
			await interaction.followUp(`Failed to start streaming: ${error.message}`);
		}
	},
};
