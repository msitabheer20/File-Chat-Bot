
interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  email?: string;
  avatar?: string;
}

interface LunchStatus {
  name: string;
  id: string;
  status: "missing both tags" | "missing #lunchstart" | "missing #lunchend" | "complete";
  lunchStartTime?: string;
  lunchEndTime?: string;
}

interface SlackLunchReport {
  channel: string;
  timeframe: "today" | "yesterday" | "this_week";
  users: LunchStatus[];
  total: number;
  timestamp: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: any;
}

export async function getSlackLunchStatus(
  channelName: string,
  timeframe: "today" | "yesterday" | "this_week" = "today"
): Promise<SlackLunchReport> {
  try {
    // Step 1: Find channel ID from name
    const channelId = await findChannelId(channelName);
    if (!channelId) {
      throw new Error(`Channel #${channelName} not found`);
    }

    // Step 2: Get all users in the channel
    const users = await getChannelUsers(channelId);

    // Step 3: Get timestamp for start of timeframe
    const startTime = getTimeframeStart(timeframe);

    // Step 4: Check each user's lunch tag status
    const lunchStatusList: LunchStatus[] = await Promise.all(
      users.map(async (user) => {
        const lunchStartResult = await hasUserPostedLunchTag(
          user.id,
          channelId,
          "#lunchstart",
          startTime
        );

        const lunchEndResult = await hasUserPostedLunchTag(
          user.id,
          channelId,
          "#lunchend",
          startTime
        );

        let status: LunchStatus["status"] = "complete";

        if (!lunchStartResult.hasPosted && !lunchEndResult.hasPosted) {
          status = "missing both tags";
        } else if (!lunchStartResult.hasPosted) {
          status = "missing #lunchstart";
        } else if (!lunchEndResult.hasPosted) {
          status = "missing #lunchend";
        }

        return {
          id: user.id,
          name: user.name,
          status,
          lunchStartTime: lunchStartResult.timestamp,
          lunchEndTime: lunchEndResult.timestamp
        };
      })
    );

    // Step 5: Filter out users who have completed both tags
    const incompleteUsers = lunchStatusList.filter(
      user => user.status !== "complete"
    );

    return {
      channel: channelName,
      timeframe,
      users: lunchStatusList,
      total: incompleteUsers.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error fetching Slack lunch status:", error);
    throw new Error(error instanceof Error ? error.message : "Failed to retrieve lunch status from Slack");
  }
}

async function findChannelId(channelName: string): Promise<string | null> {
  try {
    console.log(`Searching for channel with name: ${channelName}`);

    // First try with conversations.list which requires channels:read scope
    const response = await fetchSlackApi('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000
    });

    if (!response.ok) {
      if (response.error === 'missing_scope') {
        console.error('PERMISSION ERROR: The Slack bot token is missing required scopes.');
        console.error('Required scopes: channels:read, groups:read, im:read, mpim:read');
        console.error('Please add these scopes to your Slack app in the Slack API dashboard.');
        console.error('See: https://api.slack.com/apps > Your App > OAuth & Permissions > Scopes');
        throw new Error(`Missing Slack permission scopes. The bot needs the 'channels:read' scope to list channels.`);
      }
      throw new Error(`Failed to list channels: ${response.error}`);
    }

    // Debug info - list all channels for diagnostic purposes
    if (response.channels && response.channels.length > 0) {
      console.log(`Found ${response.channels.length} channels. Available channels:`);
      response.channels.forEach((ch: any) => {
        console.log(`- ${ch.name} (ID: ${ch.id}) ${ch.is_member ? '[Bot is a member]' : '[Bot is NOT a member]'}`);
      });
    } else {
      console.log('No channels found in the response');
    }

    // Find the channel by name
    const channel = response.channels.find(
      (ch: any) => ch.name.toLowerCase() === channelName.toLowerCase()
    );

    if (!channel) {
      console.error(`Channel #${channelName} not found in the list of accessible channels`);
      throw new Error(`Channel #${channelName} not found. Please check if the channel exists and the bot has been added to it.`);
    }

    // Check if the bot is a member of the channel
    if (!channel.is_member) {
      console.error(`Bot is not a member of channel #${channelName} (${channel.id})`);
      throw new Error(`Bot is not a member of channel #${channelName}. Please add the bot to the channel first.`);
    }

    console.log(`Found channel: ${channel.name} (ID: ${channel.id})`);
    return channel.id;
  } catch (error) {
    console.error('Error finding channel:', error);
    throw error;
  }
}

async function hasUserPostedLunchTag(
  userId: string,
  channelId: string,
  tag: "#lunchstart" | "#lunchend",
  since: number
): Promise<{ hasPosted: boolean; timestamp?: string }> {
  try {
    const sinceTimestamp = Math.floor(since / 1000);

    const response = await fetchSlackApi('conversations.history', {
      channel: channelId,
      oldest: sinceTimestamp.toString(),
      limit: 1000
    });

    if (!response.ok) {
      if (response.error === 'missing_scope') {
        console.error('PERMISSION ERROR: The Slack bot token is missing required scopes.');
        console.error('Required scope: channels:history');
        console.error('Please add this scope to your Slack app in the Slack API dashboard.');
        throw new Error(`Missing Slack permission scope. The bot needs the 'channels:history' scope to read messages.`);
      }
      throw new Error(`Failed to fetch channel history: ${response.error}`);
    }

    // Determine which tags to look for
    const tagsToFind = tag === "#lunchstart"
      ? ["#lunchstart"]
      : ["#lunchend", "#lunchover"]; // For end tags, check both variants

    // Find messages from this user that contain any of the relevant tags
    const userTagMessages = response.messages.filter((msg: any) => {
      if (msg.user !== userId || !msg.text) return false;

      const messageText = msg.text.toLowerCase();
      return tagsToFind.some(tagVariant => messageText.includes(tagVariant.toLowerCase()));
    });

    if (userTagMessages.length > 0) {
      return {
        hasPosted: true,
        timestamp: new Date(parseInt(userTagMessages[0].ts) * 1000).toISOString()
      };
    }

    return { hasPosted: false };
  } catch (error) {
    console.error(`Error checking lunch tag for user ${userId}:`, error);
    throw error;
  }
}

async function getChannelUsers(channelId: string): Promise<SlackUser[]> {
  try {

    let retries = 0;
    const maxRetries = 3;

    while (retries <= maxRetries) {
      try {
        const response = await fetchSlackApi('conversations.members', {
          channel: channelId,
          limit: 1000
        });

        if (!response.ok) {
          if (response.error === 'missing_scope') {
            console.error('PERMISSION ERROR: The Slack bot token is missing required scopes.');
            console.error('Required scope: channels:read');
            console.error('Please add this scope to your Slack app in the Slack API dashboard.');
            throw new Error(`Missing Slack permission scope. The bot needs the 'channels:read' scope to get channel members.`);
          }
          throw new Error(`Failed to get channel members: ${response.error}`);
        }

        // Process only active users to avoid errors with deleted accounts
        // Use concurrency limit to avoid rate limiting
        const userDetails: SlackUser[] = [];
        const userIds = response.members || [];

        // Process users in batches of 10 to avoid rate limiting
        const batchSize = 10;
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (userId: string) => {
              try {
                return await getUserInfo(userId);
              } catch (error) {
                console.warn(`Failed to get info for user ${userId}:`, error);
                return null;
              }
            })
          );

          // Filter out any null results from errors
          userDetails.push(...batchResults.filter(Boolean) as SlackUser[]);

          // Small delay between batches to avoid rate limiting
          if (i + batchSize < userIds.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        return userDetails;
      } catch (error) {
        retries++;

        if (retries > maxRetries) {
          throw error;
        }

        console.warn(`Retrying getChannelUsers (${retries}/${maxRetries})...`);

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
      }
    }

    // This should never be reached due to the throw in the loop
    throw new Error('Max retries exceeded');
  } catch (error) {
    console.error('Error getting channel users:', error);
    throw error;
  }
}

async function getUserInfo(userId: string): Promise<SlackUser> {
  try {
    const response = await fetchSlackApi('users.info', {
      user: userId
    });

    if (!response.ok) {
      if (response.error === 'missing_scope') {
        console.error('PERMISSION ERROR: The Slack bot token is missing required scopes.');
        console.error('Required scope: users:read');
        console.error('Please add this scope to your Slack app in the Slack API dashboard.');
        throw new Error(`Missing Slack permission scope. The bot needs the 'users:read' scope to get user information.`);
      }
      throw new Error(`Failed to get user info: ${response.error}`);
    }

    return {
      id: response.user.id,
      name: response.user.profile.display_name || response.user.name,
      real_name: response.user.profile.real_name,
      email: response.user.profile.email,
      avatar: response.user.profile.image_72
    };
  } catch (error) {
    console.error(`Error getting info for user ${userId}:`, error);
    throw error;
  }
}

async function fetchSlackApi(method: string, params: Record<string, any> = {}): Promise<SlackApiResponse> {
  try {
    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      throw new Error('SLACK_BOT_TOKEN is not defined in environment variables');
    }

    const queryParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      queryParams.append(key, value);
    });

    const url = `https://slack.com/api/${method}?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!response.ok) {
      // Check for rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '30', 10);
        console.warn(`Rate limited by Slack API. Retry after ${retryAfter} seconds.`);

        // Wait and retry once after rate limiting
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return fetchSlackApi(method, params);
      }

      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Handle pagination automatically if needed and the 'cursor' param isn't already set
    if (data.ok && data.response_metadata?.next_cursor && !params.cursor) {
      // If a paginated response with more results, fetch the next page
      console.log(`Fetching next page for ${method} with cursor: ${data.response_metadata.next_cursor}`);

      const nextPageResponse = await fetchSlackApi(method, {
        ...params,
        cursor: data.response_metadata.next_cursor
      });

      // Combine results from both pages
      if (Array.isArray(data.members)) {
        data.members = [...data.members, ...(nextPageResponse.members || [])];
      }
      if (Array.isArray(data.channels)) {
        data.channels = [...data.channels, ...(nextPageResponse.channels || [])];
      }
      if (Array.isArray(data.messages)) {
        data.messages = [...data.messages, ...(nextPageResponse.messages || [])];
      }
    }

    return data as SlackApiResponse;
  } catch (error) {
    console.error(`Error calling Slack API method ${method}:`, error);
    throw error;
  }
}

function getTimeframeStart(timeframe: "today" | "yesterday" | "this_week"): number {
  const now = new Date();
  switch (timeframe) {
    case "today":
      now.setHours(0, 0, 0, 0);
      return now.getTime();
    case "yesterday":
      now.setDate(now.getDate() - 1);
      now.setHours(0, 0, 0, 0);
      return now.getTime();
    case "this_week":
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
      now.setDate(diff);
      now.setHours(0, 0, 0, 0);
      return now.getTime();
  }
}