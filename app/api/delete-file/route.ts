import { NextResponse } from 'next/server';
import { deleteDocument } from '@/utils/pinecone';

export async function POST(req: Request) {
  try {
    const { fileId } = await req.json();

    if (!fileId) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      );
    }

    console.log('Deleting file from Pinecone:', fileId);
    await deleteDocument(fileId);
    console.log('Successfully deleted file from Pinecone');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete the file' },
      { status: 500 }
    );
  }
} 