import { NextRequest, NextResponse } from 'next/server';
import { findChannelId, getSlackLunchStatus, getSlackUpdateStatus, getSlackReportStatus } from '@/utils/slack';

export async function GET(request: NextRequest) {
  if (!process.env.SLACK_BOT_TOKEN) {
    return NextResponse.json({ error: 'SLACK_BOT_TOKEN is not set in environment variables' }, { status: 500 });
  }

  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('mode') || 'lunch';
  const channelName = searchParams.get('channel') || 'general';
  const timeframe = searchParams.get('timeframe') || 'today';
  
  console.log(`Testing Slack function mode=${mode} for channel=${channelName}, timeframe=${timeframe}`);

  try {
    let result;

    if (mode === 'lunch') {
      // Test the lunch status function
      result = await getSlackLunchStatus(
        channelName, 
        timeframe as "today" | "yesterday" | "this_week"
      );
      console.log('Lunch status result:', JSON.stringify(result, null, 2));
    } 
    else if (mode === 'update') {
      // Test the update status function
      result = await getSlackUpdateStatus(
        channelName, 
        timeframe as "today" | "yesterday" | "this_week"
      );
      console.log('Update status result:', JSON.stringify(result, null, 2));
    }
    else if (mode === 'report') {
      // Test the report status function
      result = await getSlackReportStatus(
        channelName, 
        timeframe as "today" | "yesterday" | "this_week"
      );
      console.log('Report status result:', JSON.stringify(result, null, 2));
    }
    else if (mode === 'channel') {
      // Just find the channel ID
      const channelId = await findChannelId(channelName);
      console.log(`Channel ID for #${channelName}:`, channelId);
      result = { channelName, channelId };
    }
    else {
      return NextResponse.json({ error: 'Invalid mode. Use "lunch", "update", "report", or "channel".' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error testing Slack function:', error);
    
    // Prepare a detailed error message depending on the error type
    let errorMessage = error instanceof Error ? error.message : 'Unknown error';
    let status = 500;
    
    if (errorMessage.includes('missing_scope') || errorMessage.includes('Missing Slack permission')) {
      errorMessage = `Missing required Slack permissions. The bot needs channels:read, channels:history, and users:read scopes.`;
    } else if (errorMessage.includes('not found')) {
      errorMessage = `Channel #${channelName} was not found. Please check that the channel exists.`;
      status = 404;
    } else if (errorMessage.includes('not a member')) {
      errorMessage = `The bot is not a member of #${channelName}. Please invite the bot to the channel by typing "@YourBotName" in the channel.`;
      status = 403;
    } else if (errorMessage.includes('token_revoked') || errorMessage.includes('invalid_auth')) {
      errorMessage = `Authentication error. Please check the Slack token configuration.`;
      status = 401;
    }
    
    return NextResponse.json({ error: errorMessage }, { status });
  }
} 