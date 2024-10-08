const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const axios = require('axios');
const KEYWORDS = process.env.KEYWORDS ? process.env.KEYWORDS.split(',') : [];

const parseStreamNumber = (url) => {
    const match = url.match(/\/([^\/]+)$/);
    return match ? match[1] : null;
};

function searchStreamByNumber(streams, searchSegment) {
    for (const [streamName, streamUrl] of Object.entries(streams)) {
        const lastSegment = parseStreamNumber(streamUrl);
        if (lastSegment === searchSegment) {
            return { streamName, streamUrl };
        }
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stream')
        .setDescription('Choose a stream for StreamBot to bring to your voice channel!'),
    async execute(interaction, client) {
        await interaction.deferReply();
        const filteredStreams = Object.entries(client.streams).filter(([name]) =>
            KEYWORDS.some(keyword => name.toUpperCase().includes(keyword.toUpperCase()))
        );

        if (filteredStreams.length === 0) {
            await interaction.editReply({ content: 'No streams matched the specified keywords.', ephemeral: true });
            return;
        }

        const topStreams = filteredStreams.slice(0, 100);
        
        const dropdownMenus = [];
        for (let i = 0; i < topStreams.length; i += 25) {
            const streamChunk = topStreams.slice(i, i + 25);
            const dropDownOptions = streamChunk.map(([name, url]) => {
                const shortenedUrl = parseStreamNumber(url);
                const sanitizedName = name;
                return {
                    label: sanitizedName,
                    value: shortenedUrl
                };
            });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`stream_menu_${i / 25}`)
                .setPlaceholder(`Stream List #${i / 25 + 1}`)
                .addOptions(dropDownOptions);

            const menuRow = new ActionRowBuilder().addComponents(selectMenu);
            dropdownMenus.push(menuRow);
        }

        await interaction.editReply({
            content: 'Choose a stream for StreamBot to bring to your voice channel.',
            components: dropdownMenus
        });

        const filter = i => i.customId.startsWith('stream_menu_') && i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });

        collector.on('collect', async i => {
            collector.stop();

            const { streamName, streamUrl } = searchStreamByNumber(client.streams, i.values[0]);

            const member = await i.guild.members.fetch(i.user.id);
            const voiceChannel = member.voice.channel;

            if (!voiceChannel) {
                await i.update({ content: '❌ You need to be in a voice channel to use this command.', components: [] });
                return;
            }

            const requestData = {
                guildId: i.guildId,
                channelId: voiceChannel.id,
                streamURL: streamUrl
            };

            await i.update({ content: `🔄 Attempting to start **${streamName}** in **${voiceChannel.name}**...`, components: [] });

            try {
                await axios.post(`${process.env.STREAM_BOT_URL}/play`, requestData, {
                    headers: { 'Content-Type': 'application/json' },
                });
                await i.editReply({ content: `✅ Successfully started streaming **${streamName}** in **${voiceChannel.name}**!` });
            } catch (error) {
                console.error('Error starting stream:', error);
                await i.editReply({ content: `❌ Failed to start streaming: ${error.message}` });
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({
                    content: '⏰ No stream selected. Please type `/stream` again if you still want to choose a stream.',
                    components: []
                });
            }
        });
    },
};
