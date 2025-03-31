import { NextResponse } from 'next/server';

/**
 * API endpoint to validate the Slack token and check permissions
 */
export async function GET() {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    
    // Check if token is set
    if (!token) {
      return NextResponse.json({
        valid: false,
        status: "missing",
        message: "SLACK_BOT_TOKEN is not set in environment variables",
        required_scopes: [
          "channels:read",
          "channels:history",
          "users:read",
          "groups:read" // Optional for private channels
        ]
      });
    }
    
    // Test the token with the Slack auth.test endpoint
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });
    
    if (!response.ok) {
      return NextResponse.json({
        valid: false,
        status: "http_error",
        message: `HTTP error: ${response.status}`,
        required_scopes: [
          "channels:read",
          "channels:history",
          "users:read",
          "groups:read" // Optional for private channels
        ]
      });
    }
    
    const data = await response.json();
    
    if (!data.ok) {
      return NextResponse.json({
        valid: false,
        status: data.error || "unknown_error",
        message: `Slack API error: ${data.error}`,
        required_scopes: [
          "channels:read",
          "channels:history",
          "users:read",
          "groups:read" // Optional for private channels
        ]
      });
    }
    
    // Get bot info to check scopes
    const botInfoResponse = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });
    
    const botInfoData = await botInfoResponse.json();
    
    // Now check permissions
    // Note: We can't directly check scopes with auth.test, but we can try to list channels
    // This will let us know if we have the channels:read scope
    const channelsResponse = await fetch('https://slack.com/api/conversations.list?limit=1000&types=public_channel,private_channel', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    });
    
    const channelsData = await channelsResponse.json();
    const hasChannelsReadPermission = channelsData.ok;
    
    // Check if the bot is a member of any channels
    let accessibleChannels: string[] = [];
    let inChannelCount = 0;
    let totalChannelCount = 0;
    
    if (channelsData.ok && channelsData.channels) {
      totalChannelCount = channelsData.channels.length;
      accessibleChannels = channelsData.channels
        .filter((channel: any) => channel.is_member)
        .map((channel: any) => channel.name);
      inChannelCount = accessibleChannels.length;
    }
    
    return NextResponse.json({
      valid: true,
      status: "verified",
      bot_id: data.bot_id,
      user_id: data.user_id,
      team: data.team,
      permissions: {
        channels_read: hasChannelsReadPermission,
        // We can't easily check the other permissions without specific channel IDs
        // In a complete implementation, we could check all permissions
      },
      message: "Slack token is valid",
      channel_access: {
        total_channels: totalChannelCount,
        accessible_channels: inChannelCount,
        channels: accessibleChannels.slice(0, 10), // Limit to 10 channels for display
        has_more: accessibleChannels.length > 10
      },
      required_scopes: [
        "channels:read",
        "channels:history",
        "users:read",
        "groups:read" // Optional for private channels
      ]
    });
  } catch (error) {
    console.error('Error validating Slack token:', error);
    
    return NextResponse.json({
      valid: false,
      status: "error",
      message: error instanceof Error ? error.message : 'Unknown error validating Slack token',
      required_scopes: [
        "channels:read",
        "channels:history",
        "users:read",
        "groups:read" // Optional for private channels
      ]
    }, { status: 500 });
  }
} 