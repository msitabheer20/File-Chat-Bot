import { NextResponse } from 'next/server';
import { upsertDocument } from '@/utils/pinecone';

export async function POST(req: Request) {
  try {
    const { fileId, content } = await req.json();

    if (!fileId || !content) {
      return NextResponse.json(
        { error: 'File ID and content are required' },
        { status: 400 }
      );
    }

    console.log('Processing document:', {
      fileId,
      contentLength: content.length,
      contentPreview: content.substring(0, 100) + '...'
    });

    // Process and store the document in Pinecone
    const numChunks = await upsertDocument(fileId, content);

    console.log('Document processed successfully:', {
      fileId,
      numChunks,
      averageChunkSize: Math.round(content.length / numChunks)
    });

    return NextResponse.json({
      success: true,
      message: `Document processed and stored in ${numChunks} chunks`,
    });
  } catch (error) {
    console.error('Error processing document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process the document' },
      { status: 500 }
    );
  }
} 