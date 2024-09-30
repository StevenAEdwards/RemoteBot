const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('disconnect')
		.setDescription('Disconnects Stream Bot'),
	async execute(interaction) {
		await interaction.deferReply({ephemeral: true});
		try {
			await axios.post(`${process.env.STREAM_BOT_URL}/disconnect`);
			await interaction.editReply({content: `Disconnected`});
		} catch (error) {
			console.error(error);
			await interaction.editReply({content: `Failed to Disconnect`});
		}
	},
};
