"use client"
import { useState, useEffect } from 'react';

interface SlackUser {
  id: string;
  name: string;
  status: string;
  lunchStartTime?: string;
  lunchEndTime?: string;
}

interface SlackReport {
  channel: string;
  timeframe: "today" | "yesterday" | "this_week";
  users: SlackUser[];
  total: number;
  timestamp: string;
}

export default function SlackAdminPage() {
  const [channelName, setChannelName] = useState('general');
  const [timeframe, setTimeframe] = useState<"today" | "yesterday" | "this_week">('today');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<SlackReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [tokenValidation, setTokenValidation] = useState<{
    valid: boolean;
    message: string;
    status: string;
    permissions?: Record<string, boolean>;
    channel_access?: {
      accessible_channels: number;
      total_channels: number;
      channels?: string[];
      has_more: boolean;
    };
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  async function fetchSlackStatus() {
    setIsLoading(true);
    setError(null);
    setDiagnostic(null);
    
    try {
      const response = await fetch(`/api/slack-test?channel=${channelName}&timeframe=${timeframe}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.diagnostic) {
          setDiagnostic(errorData.diagnostic);
        }
        throw new Error(errorData.error || 'Failed to fetch slack status');
      }
      
      const data = await response.json();
      setReport(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      console.error('Error fetching slack status:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function validateSlackToken() {
    setIsValidating(true);
    setTokenValidation(null);
    
    try {
      const response = await fetch('/api/slack-validate');
      const data = await response.json();
      
      setTokenValidation({
        valid: data.valid,
        message: data.message,
        status: data.status,
        permissions: data.permissions,
        channel_access: data.channel_access
      });
    } catch (err) {
      console.error('Error validating token:', err);
      setTokenValidation({
        valid: false,
        message: err instanceof Error ? err.message : 'Failed to validate token',
        status: 'error'
      });
    } finally {
      setIsValidating(false);
    }
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8">Slack Lunch Status Admin</h1>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold mb-4">Check Lunch Status</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Channel Name (without #)
            </label>
            <input
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              placeholder="general"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Timeframe
            </label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This Week</option>
            </select>
          </div>
        </div>
        
        <button
          onClick={fetchSlackStatus}
          disabled={isLoading}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Loading...' : 'Check Status'}
        </button>
      </div>
      
      {error && (
        <div className="bg-red-100 dark:bg-red-900/20 border-l-4 border-red-500 text-red-700 dark:text-red-400 p-4 mb-8" role="alert">
          <p className="font-bold">Error</p>
          <p>{error}</p>
          {error.includes('missing') && error.includes('scope') && (
            <div className="mt-2">
              <p className="font-semibold">This is a permissions error:</p>
              <p>Your Slack bot token doesn't have the necessary permissions. Please check the permission guide below.</p>
            </div>
          )}
          {diagnostic && (
            <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-700">
              <p className="font-semibold">Diagnostic Information:</p>
              <p>{diagnostic}</p>
            </div>
          )}
        </div>
      )}
      
      {report && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">
              Lunch Status for #{report.channel}
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {new Date(report.timestamp).toLocaleString()}
            </span>
          </div>
          
          <div className="mb-4">
            <span className="inline-block bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 px-2 py-1 rounded text-sm">
              {report.timeframe}
            </span>
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
              {report.total} users with missing tags
            </span>
          </div>
          
          {report.users.length === 0 ? (
            <p className="text-green-600 dark:text-green-400">
              Great! All users have properly marked their lunch status.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Lunch Start
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Lunch End
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Duration
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {report.users.map((user) => {
                    let timeGap = null;
                    let isLongBreak = false;
                    
                    if (user.lunchStartTime && user.lunchEndTime) {
                      const startTime = new Date(user.lunchStartTime).getTime();
                      const endTime = new Date(user.lunchEndTime).getTime();
                      const diffInMinutes = Math.round((endTime - startTime) / (1000 * 60));
                      timeGap = diffInMinutes;
                      isLongBreak = diffInMinutes > 30;
                    }
                    
                    return (
                      <tr key={user.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-200">
                          {user.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {user.id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium
                            ${user.status === 'missing both tags' 
                              ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' 
                              : user.status === 'missing #lunchstart'
                              ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                              : user.status === 'missing #lunchend'
                              ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200'
                              : 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            }`}
                          >
                            {user.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {user.lunchStartTime ? new Date(user.lunchStartTime).toLocaleTimeString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                          {user.lunchEndTime ? new Date(user.lunchEndTime).toLocaleTimeString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {timeGap !== null ? (
                            <span className={`${isLongBreak ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                              {timeGap} min{isLongBreak && ' (!)'}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">Send Reminders</h3>
            <button 
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 mr-4"
              onClick={() => alert('This feature is not yet implemented')}
            >
              Send Team Reminder
            </button>
            <button 
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
              onClick={() => alert('This feature is not yet implemented')}
            >
              Send Individual Reminders
            </button>
          </div>
        </div>
      )}
      
      {!report && (
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <h3 className="text-lg font-medium text-blue-800 dark:text-blue-300 mb-2">
            Slack Setup Guide
          </h3>
          
          <div className="mb-6">
            <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">Required Permissions (OAuth Scopes)</h4>
            <p className="text-blue-700 dark:text-blue-300 mb-4">
              Your Slack bot needs the following permissions:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-blue-700 dark:text-blue-300">
              <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">channels:read</code> - To list and find channels</li>
              <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">channels:history</code> - To read message history in channels</li>
              <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">users:read</code> - To get information about users</li>
              <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">groups:read</code> - For private channels (optional)</li>
            </ul>
          </div>
          
          <div className="mb-6">
            <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">Step 1: Add Permissions</h4>
            <ol className="list-decimal pl-5 space-y-1 text-blue-700 dark:text-blue-300">
              <li>Go to <a href="https://api.slack.com/apps" target="_blank" className="underline hover:text-blue-800 dark:hover:text-blue-200">api.slack.com/apps</a></li>
              <li>Select your app</li>
              <li>Click on "OAuth & Permissions" in the sidebar</li>
              <li>Scroll to "Scopes" section</li>
              <li>Add the required scopes under "Bot Token Scopes"</li>
              <li>Reinstall the app to your workspace to apply the new permissions</li>
              <li>Update your .env.local file with the new bot token if it changed</li>
            </ol>
          </div>
          
          <div>
            <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">Step 2: Invite Bot to Channels</h4>
            <p className="text-blue-700 dark:text-blue-300 mb-4">
              <strong>Important:</strong> Your bot must be a member of the channels you want to monitor.
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-blue-700 dark:text-blue-300">
              <li>Go to the Slack channel you want to monitor</li>
              <li>Type <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">@YourBotName</code> (replacing with your actual bot name)</li>
              <li>Select the bot from the dropdown that appears</li>
              <li>Send the message - this will invite the bot to the channel</li>
              <li>You should see a system message that the bot has joined the channel</li>
            </ol>
            <p className="text-blue-700 dark:text-blue-300 mt-4">
              You need to repeat this for each channel you want to monitor. The bot cannot access channels it has not been invited to.
            </p>
          </div>
        </div>
      )}
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-xl font-semibold mb-4">Slack Token Validation</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Validate your Slack bot token and check if it has the required permissions.
        </p>
        
        <button
          onClick={validateSlackToken}
          disabled={isValidating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isValidating ? 'Validating...' : 'Validate Slack Token'}
        </button>
        
        {tokenValidation && (
          <div className={`mt-4 p-4 rounded-lg ${
            tokenValidation.valid 
              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300' 
              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
          }`}>
            <p className="font-bold">{tokenValidation.valid ? 'Valid Token' : 'Invalid Token'}</p>
            <p>{tokenValidation.message}</p>
            
            {tokenValidation.permissions && (
              <div className="mt-3">
                <p className="font-semibold">Permissions:</p>
                <ul className="list-disc pl-5 mt-1">
                  <li className={tokenValidation.permissions.channels_read ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                    channels:read - {tokenValidation.permissions.channels_read ? 'Granted ✓' : 'Missing ✗'}
                  </li>
                  <li className="text-gray-600 dark:text-gray-400">
                    channels:history - Could not verify
                  </li>
                  <li className="text-gray-600 dark:text-gray-400">
                    users:read - Could not verify
                  </li>
                </ul>
              </div>
            )}
            
            {tokenValidation.channel_access && (
              <div className="mt-4">
                <p className="font-semibold">Channel Access:</p>
                <p className="mt-1">
                  Bot is a member of {tokenValidation.channel_access.accessible_channels} out of {tokenValidation.channel_access.total_channels} channels.
                </p>
                
                {tokenValidation.channel_access.channels && tokenValidation.channel_access.channels.length > 0 ? (
                  <div className="mt-2">
                    <p className="font-medium">Accessible channels:</p>
                    <ul className="list-disc pl-5 mt-1">
                      {tokenValidation.channel_access.channels.map((channel: string) => (
                        <li key={channel} className="text-blue-700 dark:text-blue-300">
                          #{channel}
                        </li>
                      ))}
                      {tokenValidation.channel_access.has_more && (
                        <li className="italic text-gray-600 dark:text-gray-400">
                          ...and more
                        </li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-2 text-amber-600 dark:text-amber-400 font-medium">
                    The bot is not a member of any channels. Please invite it to channels you want to monitor.
                  </p>
                )}
              </div>
            )}
            
            {!tokenValidation.valid && tokenValidation.status === 'missing_scope' && (
              <div className="mt-3">
                <p className="font-semibold">Required scopes are missing. Please add them to your Slack app.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 