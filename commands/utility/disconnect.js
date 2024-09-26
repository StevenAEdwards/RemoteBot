const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('disconnect')
		.setDescription('Disconnects Stream Bot'),
	async execute(interaction) {
		await interaction.deferReply();
		try {
			await axios.post('http://192.168.86.214:3123/disconnect');
			await interaction.followUp(`Disconnected`);
		} catch (error) {
			console.error(error);
			await interaction.followUp(`Failed to Disconnect`);
		}
	},
};
