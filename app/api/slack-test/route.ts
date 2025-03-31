import { NextResponse } from 'next/server';
import { getSlackLunchStatus } from '@/utils/slack';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get('channel') || 'general';
  const timeframe = (searchParams.get('timeframe') as "today" | "yesterday" | "this_week") || 'today';
  
  // Check if Slack token is configured
  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json(
      { 
        error: 'Slack bot token not configured', 
        diagnostic: 'The SLACK_BOT_TOKEN environment variable is not set. Please add it to your .env.local file.' 
      }, 
      { status: 500 }
    );
  }
  
  try {
    console.log(`Testing Slack lunch status for channel: #${channelName} with timeframe: ${timeframe}`);
    
    // Use the Slack utility function
    const slackData = await getSlackLunchStatus(channelName, timeframe);
    
    // Return all data in the response
    return NextResponse.json({
      success: true,
      message: `Successfully fetched lunch status for #${channelName}`,
      data: slackData
    });
  } catch (error) {
    console.error('Error testing Slack lunch status:', error);
    
    // Prepare diagnostic information
    let diagnostic = 'An unexpected error occurred.';
    let statusCode = 500;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Handle known error types with specific messages
    if (errorMessage.includes('Channel not found')) {
      diagnostic = `The channel #${channelName} could not be found. Verify that:
                   1. The channel exists (check for typos)
                   2. Your bot has been invited to this channel
                   3. Your bot has the 'channels:read' permission`;
      statusCode = 404;
    } else if (errorMessage.includes('Bot is not a member')) {
      diagnostic = `Your bot is not a member of channel #${channelName}. Please add the bot to this channel:
                   1. Go to #${channelName} in Slack
                   2. Type @YourBotName to invite it
                   3. Verify it shows up in the channel members list`;
      statusCode = 403;
    } else if (errorMessage.includes('Missing Slack permission scope')) {
      diagnostic = 'Your Slack bot token is missing required permissions. Please check the permissions guide below.';
      statusCode = 401;
    }
    
    return NextResponse.json(
      { error: errorMessage, diagnostic }, 
      { status: statusCode }
    );
  }
} 