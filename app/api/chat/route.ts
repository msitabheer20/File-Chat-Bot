import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { FileData } from '@/types/chat';
import { queryPinecone, verifyDocumentStorage } from '@/utils/pinecone';

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

export async function POST(req: Request) {
  try {
    console.log('Received chat request');
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
        
        Be friendly and encouraging in your response.`;
      } else {
        systemPrompt = `You are a helpful AI assistant that answers questions based on the provided document context. 
        Use the following context to answer the user's question. If the context doesn't contain enough information to answer the question, 
        say so. Do not make up information that isn't in the context. Be specific and cite relevant parts of the context in your answer.

        Context: ${context}`;
      }
    } else {
      console.log('\n=== Processing Basic Chat ===');
      console.log('Message:', message);
      // Basic chat without documents
      systemPrompt = `You are a helpful AI assistant. Provide clear, concise, and accurate answers to the user's questions. 
      If you're not sure about something, say so. Be friendly and professional in your responses.`;
    }

    console.log('\n=== System Prompt ===');
    console.log('Prompt length:', systemPrompt.length);
    console.log('Prompt preview:', systemPrompt.substring(0, 200) + '...');

    // Get response from OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    console.log('\n=== OpenAI Response ===');
    console.log('Response length:', completion.choices[0].message.content?.length);
    console.log('Response preview:', completion.choices[0].message.content?.substring(0, 200) + '...');

    return NextResponse.json({
      content: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process the request' },
      { status: 500 }
    );
  }
}