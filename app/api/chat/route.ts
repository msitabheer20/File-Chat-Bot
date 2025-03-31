import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { FileData } from '@/types/chat';
import { queryPinecone, verifyDocumentStorage } from '@/utils/pinecone';
import { getSlackLunchStatus } from '@/utils/slack';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function to split text into chunks
function splitIntoChunks(text: string, maxChunkSize: number = 8000): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

// Define the available functions
const availableFunctions = {
  setTheme: {
    name: "setTheme",
    description: "Set the theme of the application to light or dark mode",
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "string",
          enum: ["light", "dark"],
          description: "The theme to set for the application",
        },
      },
      required: ["theme"],
    },
  },
  getSlackLunchStatus: {
    name: "getSlackLunchStatus",
    description: "Get the lunch status from Slack for a specific channel",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "The name of the Slack channel to check (without the # symbol)"
        },
        timeframe: {
          type: "string",
          enum: ["today", "yesterday", "this_week"],
          description: "The timeframe to check for lunch status messages (default: today)"
        }
      },
      required: ["channelName"]
    },
    examples: [
      {
        channelName: "general",
        timeframe: "today"
      }
    ],
    additionalInformation: "This function checks if users in the specified Slack channel have posted #lunchstart and #lunchend messages. For lunch end, both #lunchend and #lunchover tags are recognized as equivalent."
  },
};

export async function POST(req: Request) {
  try {
    const { message, files } = await req.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    let context = '';
    let systemPrompt = '';

    if (files && files.length > 0) {
      console.log('\n=== Processing Document-Based Chat ===');
      console.log('Message:', message);
      console.log('Number of files:', files.length);
      console.log('File IDs:', files.map((f: FileData) => f.id));

      // Verify document storage before querying
      for (const file of files) {
        if (!file.id) {
          console.error(`File ${file.name} has no ID`);
          continue;
        }
        const vectorCount = await verifyDocumentStorage(file.id);
        console.log(`Found ${vectorCount} vectors for file ${file.name}`);
      }

      // Get relevant chunks from Pinecone for each file
      const relevantChunks = await Promise.all(
        files.map(async (file: FileData) => {
          try {
            if (!file.id) {
              console.error(`File ${file.name} has no ID`);
              return '';
            }
            console.log(`\nQuerying Pinecone for file: ${file.name}`);
            const chunks = await queryPinecone(message, file.id);
            console.log(`Found ${chunks.length} relevant chunks for file ${file.name}`);
            return chunks.join('\n\n');
          } catch (error) {
            console.error(`Error querying Pinecone for file ${file.name}:`, error);
            return '';
          }
        })
      );

      // Filter out empty chunks and combine the rest
      context = relevantChunks.filter(chunk => chunk.trim()).join('\n\n');

      console.log('\n=== Context Details ===');
      console.log('Context length:', context.length);
      console.log('Number of chunks:', relevantChunks.filter(chunk => chunk.trim()).length);
      console.log('\nFull Context:');
      console.log('------------------------');
      console.log(context);
      console.log('------------------------');

      if (!context.trim()) {
        console.log('\nNo relevant context found for the query');
        // Instead of returning an error, provide a helpful response
        systemPrompt = `You are a helpful AI assistant. The user has uploaded documents but their question doesn't match any specific content in those documents. 
        Please respond in a helpful way, suggesting that they:
        1. Try rephrasing their question
        2. Ask about specific topics or sections they're interested in
        3. Share what they're looking for, and you can help guide them to the right questions
        
        Be friendly and encouraging in your response.
        
        You also have the ability to control the theme of the application. If the user asks to change the theme (light/dark), use the setTheme function.
        
        If the user asks about Slack lunch status tracking, use the getSlackLunchStatus function to help them.`;
      } else {
        systemPrompt = `You are a helpful AI assistant that answers questions based on the provided document context. 
        Use the following context to answer the user's question. If the context doesn't contain enough information to answer the question, 
        say so. Do not make up information that isn't in the context. Be specific and cite relevant parts of the context in your answer.

        Context: ${context}
        
        You also have the ability to control the theme of the application. If the user asks to change the theme (light/dark), use the setTheme function.
        
        If the user asks about Slack lunch status tracking, use the getSlackLunchStatus function to help them.`;
      }
    } else {
      console.log('\n=== Processing Basic Chat ===');
      console.log('Message:', message);
      // Basic chat without documents
      systemPrompt = `You are a helpful AI assistant. Provide clear, concise, and accurate answers to the user's questions. 
      If you're not sure about something, say so. Be friendly and professional in your responses.
      
      You also have the ability to control the theme of the application. If the user asks to change the theme (light/dark), use the setTheme function.
      
      If the user asks about Slack lunch status tracking, use the getSlackLunchStatus function to help them.`;
    }

    console.log('\n=== System Prompt ===');
    console.log('Prompt length:', systemPrompt.length);
    console.log('Prompt preview:', systemPrompt.substring(0, 200) + '...');

    // Get response from OpenAI with function calling
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 500,
      tools: [
        {
          type: "function",
          function: availableFunctions.setTheme,
        },
        {
          type: "function",
          function: availableFunctions.getSlackLunchStatus,
        },
      ],
      tool_choice: "auto",
    });

    const responseMessage = completion.choices[0].message;
    
    // Check if the model wants to call a function
    const toolCalls = responseMessage.tool_calls;
    if (toolCalls) {
      console.log('\n=== Function Call Detected ===');
      
      for (const toolCall of toolCalls) {
        if (toolCall.type === 'function' && toolCall.function.name === 'setTheme') {
          const functionArgs = JSON.parse(toolCall.function.arguments);
          const theme = functionArgs.theme;
          
          console.log(`Function call: setTheme(${theme})`);
          
          // Return with function call information
          return NextResponse.json({
            content: responseMessage.content || "I'll change the theme for you.",
            functionCall: {
              name: 'setTheme',
              arguments: { theme }
            }
          });
        }
        else if (toolCall.type === 'function' && toolCall.function.name === 'getSlackLunchStatus') {
          const functionArgs = JSON.parse(toolCall.function.arguments);
          const channelName = functionArgs.channelName;
          const timeframe = functionArgs.timeframe || 'today';
          
          console.log(`Function call: getSlackLunchStatus(${channelName}, ${timeframe})`);
          
          try {
            // Check if Slack token is set
            if (!process.env.SLACK_BOT_TOKEN) {
              return NextResponse.json({
                content: `I was unable to check the lunch status for #${channelName}. The Slack bot token is not configured.`,
                error: 'SLACK_BOT_TOKEN is not set in environment variables'
              });
            }
            
            // Get actual data from the Slack utility (currently returns mock data)
            const slackData = await getSlackLunchStatus(
              channelName, 
              timeframe as "today" | "yesterday" | "this_week"
            );
            
            // Return with function call information - Only use the formatted message, not the model's content
            return NextResponse.json({
              content: null, // No formatted content, just raw data
              functionCall: {
                name: 'getSlackLunchStatus',
                arguments: { channelName, timeframe },
                result: slackData
              }
            });
          } catch (error) {
            console.error('Error getting Slack lunch status:', error);
            
            const errorMessage = error instanceof Error ? error.message : 'Unknown error with Slack integration';
            let detailedMessage = `I was unable to retrieve the lunch status information for #${channelName}. There might be an issue with the Slack integration.`;
            
            // Provide more helpful messages based on error type
            if (errorMessage.includes('missing_scope') || errorMessage.includes('Missing Slack permission')) {
              detailedMessage = `I'm unable to check lunch status because the Slack bot needs additional permissions. Please ask an administrator to update the Slack app's permissions to include: channels:read, channels:history, and users:read scopes.`;
            } else if (errorMessage.includes('not found')) {
              detailedMessage = `I couldn't find a channel named #${channelName}. Please check that the channel exists and I have been added to the workspace.`;
            } else if (errorMessage.includes('not a member')) {
              detailedMessage = `I'm not a member of the #${channelName} channel. Please invite me to the channel by typing "@YourBotName" in the channel, then try again.`;
            } else if (errorMessage.includes('token_revoked') || errorMessage.includes('invalid_auth')) {
              detailedMessage = `There's an authentication issue with the Slack integration. Please ask an administrator to check the Slack token configuration.`;
            }
            
            // Return error message
            return NextResponse.json({
              content: detailedMessage,
              error: errorMessage
            });
          }
        }
      }
    }

    console.log('\n=== OpenAI Response ===');
    console.log('Response length:', responseMessage.content?.length);
    console.log('Response preview:', responseMessage.content?.substring(0, 200) + '...');

    return NextResponse.json({
      content: responseMessage.content,
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process the request' },
      { status: 500 }
    );
  }
}