import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { FileData } from '@/types/chat';
import { queryPinecone } from '@/utils/pinecone';

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
    const { message, files } = await req.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'Please upload at least one document before asking questions' },
        { status: 400 }
      );
    }

    console.log('Processing chat request:', {
      message,
      numFiles: files.length,
      fileIds: files.map(f => f.id)
    });

    // Get relevant chunks from Pinecone for each file
    const relevantChunks = await Promise.all(
      files.map(async (file: FileData) => {
        try {
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
    const context = relevantChunks.filter(chunk => chunk.trim()).join('\n\n');

    if (!context.trim()) {
      console.log('No relevant context found for the query');
      return NextResponse.json(
        { error: 'No relevant information found in the documents to answer your question. Try rephrasing your question or asking about a different topic.' },
        { status: 400 }
      );
    }

    console.log('Context length:', context.length);
    console.log('Context preview:', context.substring(0, 200) + '...');

    // Create the system prompt with context
    const systemPrompt = `You are a helpful AI assistant that answers questions based on the provided document context. 
    Use the following context to answer the user's question. If the context doesn't contain enough information to answer the question, 
    say so. Do not make up information that isn't in the context. Be specific and cite relevant parts of the context in your answer.

    Context:
    ${context}`;

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

    return NextResponse.json({
      response: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process the request' },
      { status: 500 }
    );
  }
}